import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminExpenseKind, AdminExpensePeriod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertAdminExpenseDto } from './dto/upsert-admin-expense.dto';

@Injectable()
export class AdminExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.adminExpense.findMany({
      orderBy: [{ active: 'desc' }, { kind: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      period: r.period,
      amountCOP: r.amountCOP.toFixed(0),
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async upsert(dto: UpsertAdminExpenseDto) {
    const period = dto.period ?? AdminExpensePeriod.MONTHLY;
    const row = await this.prisma.adminExpense.upsert({
      where: { kind: dto.kind as AdminExpenseKind },
      create: {
        kind: dto.kind,
        name: dto.name,
        period,
        amountCOP: new Prisma.Decimal(dto.amountCOP),
        active: dto.active ?? true,
      },
      update: {
        name: dto.name,
        period,
        amountCOP: new Prisma.Decimal(dto.amountCOP),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      period: row.period,
      amountCOP: row.amountCOP.toFixed(0),
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async remove(kind: AdminExpenseKind) {
    const existing = await this.prisma.adminExpense.findUnique({
      where: { kind },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Admin expense not found');
    await this.prisma.adminExpense.delete({ where: { kind } });
    return { ok: true };
  }
}

