import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { slugifyCompanyLabel } from '../auth/company-slug';
import { isPlatformAdminEmail } from '../auth/platform-admins';
import { isUnlimitedPlan, UsageService } from '../billing/usage.service';

/** Los tres módulos que toda cuenta puede activar de entrada. */
export const CORE_MODULE_SLUGS = ['sales', 'inventory', 'booking'] as const;

function latestIso(
  ...values: Array<Date | string | null | undefined>
): string | null {
  const times = values
    .map((v) => (v ? new Date(v).getTime() : Number.NaN))
    .filter((n) => Number.isFinite(n));
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usage: UsageService,
  ) {}

  private slugFromCompany(name: string, shopSlug: string | null): string {
    return shopSlug?.trim() || slugifyCompanyLabel(name);
  }

  private isCoreModule(slug: string): boolean {
    return (CORE_MODULE_SLUGS as readonly string[]).includes(slug);
  }

  private async moduleCatalog() {
    return this.prisma.module.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, description: true },
    });
  }

  private mapCompanyModules(
    catalog: Array<{ slug: string; name: string }>,
    enabledSlugs: Iterable<string>,
  ) {
    const enabled = new Set(enabledSlugs);
    const coreOrder = new Map<string, number>(
      CORE_MODULE_SLUGS.map((slug, i) => [slug, i]),
    );
    return [...catalog]
      .sort((a, b) => {
        const ac = coreOrder.has(a.slug) ? (coreOrder.get(a.slug) ?? 99) : 100;
        const bc = coreOrder.has(b.slug) ? (coreOrder.get(b.slug) ?? 99) : 100;
        if (ac !== bc) return ac - bc;
        return a.name.localeCompare(b.name, 'es');
      })
      .map((mod) => ({
        slug: mod.slug,
        name: mod.name,
        enabled: enabled.has(mod.slug),
        core: this.isCoreModule(mod.slug),
      }));
  }

  async overview() {
    const [
      companiesCount,
      activeCompanies,
      usersCount,
      pendingRequests,
      recentRequests,
      users,
      companies,
      salesAgg,
      productsCount,
      inventoryCount,
      lastSales,
    ] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { active: true } }),
      this.prisma.accessRequest.count({ where: { status: 'PENDING' } }),
      this.prisma.accessRequest.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.user.findMany({
        where: { active: true },
        orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          email: true,
          name: true,
          isPlatformAdmin: true,
          createdAt: true,
          lastLoginAt: true,
          memberships: {
            where: { status: 'ACTIVE' },
            include: {
              company: { select: { id: true, name: true } },
              memberRoles: { include: { role: { select: { slug: true } } } },
            },
          },
        },
      }),
      this.prisma.company.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          plan: true,
          shopSlug: true,
          _count: {
            select: {
              members: true,
              products: true,
              sales: true,
              inventoryItems: true,
            },
          },
          companyModules: {
            where: { isEnabled: true },
            include: { module: { select: { slug: true, name: true } } },
          },
        },
      }),
      this.prisma.sale.aggregate({
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.product.count(),
      this.prisma.inventoryItem.count(),
      this.prisma.sale.groupBy({
        by: ['companyId'],
        _sum: { total: true },
        _max: { saleDate: true },
      }),
    ]);

    const salesByCompany = new Map(
      lastSales.map((row) => [
        row.companyId,
        {
          total: Number(row._sum.total ?? 0),
          lastSaleAt: row._max.saleDate?.toISOString() ?? null,
        },
      ]),
    );

    return {
      companiesCount,
      activeCompanies,
      usersCount,
      pendingRequests,
      totals: {
        salesCount: Number(salesAgg._count._all ?? 0),
        salesTotal: Number(salesAgg._sum.total ?? 0),
        productsCount,
        inventoryCount,
      },
      recentRequests,
      recentUsers: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        isPlatformAdmin: u.isPlatformAdmin,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        companies: u.memberships.map((m) => ({
          id: m.company.id,
          name: m.company.name,
          role: m.memberRoles[0]?.role.slug ?? 'member',
        })),
      })),
      companyStats: companies.map((c) => {
        const sales = salesByCompany.get(c.id);
        return {
          id: c.id,
          name: c.name,
          slug: this.slugFromCompany(c.name, c.shopSlug),
          plan: c.plan,
          membersCount: c._count.members,
          productsCount: c._count.products,
          salesCount: c._count.sales,
          salesTotal: sales?.total ?? 0,
          lastSaleAt: sales?.lastSaleAt ?? null,
          inventoryCount: c._count.inventoryItems,
          modules: c.companyModules.map((cm) => cm.module.slug),
          moduleNames: c.companyModules.map((cm) => cm.module.name),
        };
      }),
    };
  }

  async listCompanies() {
    const companies = await this.prisma.company.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            members: true,
            products: true,
            sales: true,
            shopOrders: true,
          },
        },
        companyModules: {
          where: { isEnabled: true },
          include: { module: { select: { slug: true, name: true } } },
          orderBy: { module: { sortOrder: 'asc' } },
        },
      },
    });

    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: this.slugFromCompany(c.name, c.shopSlug),
      shopSlug: c.shopSlug,
      status: c.status,
      plan: c.plan,
      email: c.email,
      phone: c.phone,
      membersCount: c._count.members,
      productsCount: c._count.products,
      salesCount: c._count.sales,
      shopOrdersCount: c._count.shopOrders,
      modules: c.companyModules.map((cm) => ({
        slug: cm.module.slug,
        name: cm.module.name,
      })),
    }));
  }

  async companyDetail(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        _count: {
          select: {
            members: true,
            products: true,
            sales: true,
            inventoryItems: true,
            purchaseLots: true,
            staffMembers: true,
            shopOrders: true,
          },
        },
        companyModules: {
          where: { isEnabled: true },
          include: { module: { select: { slug: true, name: true } } },
          orderBy: { module: { sortOrder: 'asc' } },
        },
        members: {
          include: {
            user: { select: { id: true, email: true, name: true, active: true } },
            memberRoles: {
              include: { role: { select: { slug: true, name: true } } },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!company) return null;

    const catalog = await this.moduleCatalog();
    const enabledSlugs = company.companyModules
      .filter((cm) => cm.isEnabled)
      .map((cm) => cm.module.slug);

    return {
      id: company.id,
      name: company.name,
      slug: this.slugFromCompany(company.name, company.shopSlug),
      shopSlug: company.shopSlug,
      status: company.status,
      plan: company.plan,
      email: company.email,
      phone: company.phone,
      address: company.address,
      counts: {
        members: company._count.members,
        products: company._count.products,
        sales: company._count.sales,
        inventoryItems: company._count.inventoryItems,
        purchaseLots: company._count.purchaseLots,
        staffMembers: company._count.staffMembers,
        shopOrders: company._count.shopOrders,
      },
      modules: company.companyModules.map((cm) => ({
        slug: cm.module.slug,
        name: cm.module.name,
      })),
      allModules: this.mapCompanyModules(catalog, enabledSlugs),
      members: company.members.map((m) => ({
        id: m.user.id,
        email: m.user.email,
        name: m.user.name,
        active: m.user.active,
        status: m.status,
        roles: m.memberRoles.map((mr) => mr.role.slug),
      })),
    };
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        isPlatformAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                shopSlug: true,
                plan: true,
                storageLimitBytes: true,
              },
            },
            memberRoles: { include: { role: { select: { slug: true } } } },
          },
        },
      },
    });

    const companyIds = [
      ...new Set(users.flatMap((u) => u.memberships.map((m) => m.company.id))),
    ];
    const userIds = users.map((u) => u.id);

    const [storageMap, saleAgg, taskAgg, closeAgg, auditAgg] = await Promise.all([
      this.usage.getStorageByCompanyIds(companyIds),
      userIds.length
        ? this.prisma.sale.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds } },
            _count: { _all: true },
            _max: { saleDate: true, createdAt: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.companyTask.groupBy({
            by: ['createdById'],
            where: { createdById: { in: userIds } },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.cashClose.groupBy({
            by: ['closedByUserId'],
            where: { closedByUserId: { in: userIds } },
            _count: { _all: true },
            _max: { closedAt: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.auditLog.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds } },
            _count: { _all: true },
            _max: { createdAt: true },
          })
        : Promise.resolve([]),
    ]);

    type ActivityAgg = { count: number; at: Date | null };
    const salesByUser = new Map<string, ActivityAgg>();
    for (const row of saleAgg) {
      if (!row.userId) continue;
      salesByUser.set(row.userId, {
        count: row._count._all,
        at: row._max.saleDate ?? row._max.createdAt,
      });
    }
    const tasksByUser = new Map<string, ActivityAgg>();
    for (const row of taskAgg) {
      if (!row.createdById) continue;
      tasksByUser.set(row.createdById, {
        count: row._count._all,
        at: row._max.createdAt,
      });
    }
    const closesByUser = new Map<string, ActivityAgg>();
    for (const row of closeAgg) {
      if (!row.closedByUserId) continue;
      closesByUser.set(row.closedByUserId, {
        count: row._count._all,
        at: row._max.closedAt,
      });
    }
    const auditsByUser = new Map<string, ActivityAgg>();
    for (const row of auditAgg) {
      if (!row.userId) continue;
      auditsByUser.set(row.userId, {
        count: row._count._all,
        at: row._max.createdAt,
      });
    }

    return users.map((u) => {
      const companies = u.memberships.map((m) => {
        const storageUsedBytes = storageMap.get(m.company.id) ?? 0;
        const unlimited = isUnlimitedPlan(m.company.plan);
        const storageLimitBytes = unlimited
          ? 0
          : m.company.storageLimitBytes || 25 * 1024 * 1024;
        return {
          id: m.company.id,
          name: m.company.name,
          slug: this.slugFromCompany(m.company.name, m.company.shopSlug),
          role: m.memberRoles[0]?.role.slug ?? 'member',
          status: m.status,
          plan: m.company.plan,
          storageUsedBytes,
          storageLimitBytes,
          storageRemainingBytes: unlimited
            ? null
            : Math.max(0, storageLimitBytes - storageUsedBytes),
        };
      });
      const sales = salesByUser.get(u.id);
      const tasks = tasksByUser.get(u.id);
      const closes = closesByUser.get(u.id);
      const audits = auditsByUser.get(u.id);
      const lastLoginAt = u.lastLoginAt?.toISOString() ?? null;
      const lastActivityAt = latestIso(
        u.lastLoginAt,
        sales?.at,
        tasks?.at,
        closes?.at,
        audits?.at,
        u.createdAt,
      );

      return {
        id: u.id,
        email: u.email,
        name: u.name,
        active: u.active,
        isPlatformAdmin: u.isPlatformAdmin || isPlatformAdminEmail(u.email),
        createdAt: u.createdAt,
        lastLoginAt,
        lastActivityAt,
        salesCount: sales?.count ?? 0,
        tasksCount: tasks?.count ?? 0,
        cashClosesCount: closes?.count ?? 0,
        auditCount: audits?.count ?? 0,
        storageUsedBytes: companies.reduce(
          (sum, c) => sum + c.storageUsedBytes,
          0,
        ),
        storageLimitBytes: companies.reduce(
          (sum, c) => sum + (c.storageLimitBytes || 0),
          0,
        ),
        storageUnlimited: companies.some((c) => isUnlimitedPlan(c.plan ?? 'TRIAL'))
          && companies.every((c) => isUnlimitedPlan(c.plan ?? 'TRIAL')),
        companies,
      };
    });
  }

  async userDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        isPlatformAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        memberships: {
          include: {
            company: {
              select: {
                id: true,
                name: true,
                shopSlug: true,
                plan: true,
                storageLimitBytes: true,
                companyModules: {
                  include: { module: { select: { slug: true, name: true } } },
                },
              },
            },
            memberRoles: { include: { role: { select: { slug: true } } } },
          },
        },
      },
    });
    if (!user) return null;

    const [sales, tasks, logs, closes, usageList, counts, catalog] = await Promise.all([
      this.prisma.sale.findMany({
        where: { userId },
        orderBy: { saleDate: 'desc' },
        take: 12,
        select: {
          id: true,
          code: true,
          total: true,
          saleDate: true,
          paymentMethod: true,
          company: { select: { name: true } },
        },
      }),
      this.prisma.companyTask.findMany({
        where: { OR: [{ createdById: userId }, { assignedToId: userId }] },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: {
          id: true,
          title: true,
          taskDate: true,
          completed: true,
          createdAt: true,
          createdById: true,
          assignedToId: true,
          company: { select: { name: true } },
        },
      }),
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          action: true,
          tableName: true,
          createdAt: true,
          company: { select: { name: true } },
        },
      }),
      this.prisma.cashClose.findMany({
        where: { closedByUserId: userId },
        orderBy: { closedAt: 'desc' },
        take: 8,
        select: {
          id: true,
          closeDate: true,
          closedAt: true,
          status: true,
          salesTotalCOP: true,
          company: { select: { name: true } },
        },
      }),
      Promise.all(
        user.memberships.map(async (m) => ({
          companyId: m.company.id,
          usage: await this.usage.getUsage(m.company.id),
        })),
      ),
      Promise.all([
        this.prisma.sale.count({ where: { userId } }),
        this.prisma.companyTask.count({
          where: { OR: [{ createdById: userId }, { assignedToId: userId }] },
        }),
        this.prisma.cashClose.count({ where: { closedByUserId: userId } }),
        this.prisma.auditLog.count({ where: { userId } }),
      ]),
      this.moduleCatalog(),
    ]);
    const [salesCount, tasksCount, cashClosesCount, auditCount] = counts;

    const usageByCompany = new Map(
      usageList.map((row) => [row.companyId, row.usage]),
    );
    const companies = user.memberships.map((m) => {
      const usage = usageByCompany.get(m.company.id);
      const unlimited = isUnlimitedPlan(m.company.plan);
      const storageUsedBytes = usage?.storageUsedBytes ?? 0;
      const storageLimitBytes = unlimited
        ? 0
        : usage?.storageLimitBytes || m.company.storageLimitBytes || 25 * 1024 * 1024;
      const enabledSlugs = m.company.companyModules
        .filter((cm) => cm.isEnabled)
        .map((cm) => cm.module.slug);
      return {
        id: m.company.id,
        name: m.company.name,
        slug: this.slugFromCompany(m.company.name, m.company.shopSlug),
        role: m.memberRoles[0]?.role.slug ?? 'member',
        status: m.status,
        plan: m.company.plan,
        storageUsedBytes,
        storageLimitBytes,
        storageRemainingBytes: unlimited
          ? null
          : Math.max(0, storageLimitBytes - storageUsedBytes),
        usage,
        modules: this.mapCompanyModules(catalog, enabledSlugs),
      };
    });

    const lastLoginAt = user.lastLoginAt?.toISOString() ?? null;
    const lastActivityAt = latestIso(
      user.lastLoginAt,
      sales[0]?.saleDate,
      tasks[0]?.createdAt,
      logs[0]?.createdAt,
      closes[0]?.closedAt,
      user.createdAt,
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      active: user.active,
      isPlatformAdmin: user.isPlatformAdmin || isPlatformAdminEmail(user.email),
      createdAt: user.createdAt,
      lastLoginAt,
      lastActivityAt,
      salesCount,
      tasksCount,
      cashClosesCount,
      auditCount,
      storageUsedBytes: companies.reduce(
        (sum, c) => sum + c.storageUsedBytes,
        0,
      ),
      storageLimitBytes: companies.reduce(
        (sum, c) => sum + (c.storageLimitBytes || 0),
        0,
      ),
      storageUnlimited:
        companies.length > 0 &&
        companies.every((c) => isUnlimitedPlan(c.plan ?? 'TRIAL')),
      companies,
      recentSales: sales.map((s) => ({
        id: s.id,
        code: s.code,
        total: Number(s.total),
        saleDate: s.saleDate,
        paymentMethod: s.paymentMethod,
        companyName: s.company.name,
      })),
      recentTasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        taskDate: t.taskDate,
        completed: t.completed,
        createdAt: t.createdAt,
        kind:
          t.createdById === userId && t.assignedToId === userId
            ? 'created_assigned'
            : t.createdById === userId
              ? 'created'
              : 'assigned',
        companyName: t.company.name,
      })),
      recentLogs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        tableName: l.tableName,
        createdAt: l.createdAt,
        companyName: l.company?.name ?? null,
      })),
      recentCashCloses: closes.map((c) => ({
        id: c.id,
        closeDate: c.closeDate,
        closedAt: c.closedAt,
        status: c.status,
        salesTotalCOP: Number(c.salesTotalCOP),
        companyName: c.company.name,
      })),
    };
  }

  async updateUser(
    userId: string,
    input: { active?: boolean; name?: string; email?: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const data: { active?: boolean; name?: string; email?: string } = {};
    if (typeof input.active === 'boolean') {
      if (!input.active && isPlatformAdminEmail(user.email)) {
        throw new BadRequestException(
          'No se puede desactivar una cuenta de administración de plataforma',
        );
      }
      data.active = input.active;
    }
    if (input.name?.trim()) data.name = input.name.trim();
    if (input.email && input.email !== user.email) {
      if (isPlatformAdminEmail(user.email)) {
        throw new BadRequestException(
          'No se puede cambiar el correo de una cuenta de administración',
        );
      }
      const taken = await this.prisma.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (taken && taken.id !== userId) {
        throw new BadRequestException('Ya existe una cuenta con ese email');
      }
      data.email = input.email;
    }
    if (Object.keys(data).length) {
      await this.prisma.user.update({ where: { id: userId }, data });
    }
    const detail = await this.userDetail(userId);
    if (!detail) throw new NotFoundException('Usuario no encontrado');
    return detail;
  }

  async deleteUser(userId: string, actorId: string) {
    if (userId === actorId) {
      throw new ForbiddenException('No puede eliminar su propia cuenta');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (isPlatformAdminEmail(user.email)) {
      throw new BadRequestException(
        'No se puede eliminar una cuenta de administración de plataforma',
      );
    }
    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true as const, id: userId };
  }

  async listModules() {
    const catalog = await this.moduleCatalog();
    return catalog.map((mod) => ({
      slug: mod.slug,
      name: mod.name,
      description: mod.description,
      core: this.isCoreModule(mod.slug),
    }));
  }

  async setCompanyModule(companyId: string, slug: string, enabled: boolean) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const mod = await this.prisma.module.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true },
    });
    if (!mod) throw new NotFoundException('Módulo no encontrado');

    await this.prisma.companyModule.upsert({
      where: {
        companyId_moduleId: { companyId, moduleId: mod.id },
      },
      create: {
        companyId,
        moduleId: mod.id,
        isEnabled: enabled,
      },
      update: { isEnabled: enabled },
    });

    const catalog = await this.moduleCatalog();
    const rows = await this.prisma.companyModule.findMany({
      where: { companyId, isEnabled: true },
      include: { module: { select: { slug: true } } },
    });
    return {
      companyId,
      slug: mod.slug,
      name: mod.name,
      enabled,
      modules: this.mapCompanyModules(
        catalog,
        rows.map((row) => row.module.slug),
      ),
    };
  }

  async setCompanyPlan(companyId: string, plan: 'TRIAL' | 'PRO' | 'BUSINESS') {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const updated = await this.prisma.company.update({
      where: { id: companyId },
      data: { plan },
      select: { id: true, name: true, plan: true },
    });
    return updated;
  }

  async listAccessRequests(status?: string) {
    const where =
      status === 'PENDING' || status === 'APPROVED' || status === 'REJECTED'
        ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' }
        : undefined;

    return this.prisma.accessRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
