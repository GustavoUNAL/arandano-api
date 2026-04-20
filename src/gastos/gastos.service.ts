import { Injectable } from '@nestjs/common';
import { GastoKind, GastoPeriod, GastoType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGastoDto } from './dto/upsert-gasto.dto';

@Injectable()
export class GastosService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.gasto.findMany({
      orderBy: [{ active: 'desc' }, { kind: 'asc' }, { type: 'asc' }],
    });

    const items = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      type: r.type,
      name: r.name,
      period: r.period,
      amountCOP: r.amountCOP.toFixed(0),
      active: r.active,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    const fixed = items.filter((r) => r.kind === GastoKind.FIJO);
    const variable = items.filter((r) => r.kind === GastoKind.VARIABLE);

    const sum = (xs: typeof fixed) =>
      xs.reduce((acc, x) => acc + Number(x.amountCOP), 0);

    const groupByType = (xs: typeof items) => {
      const m = new Map<string, typeof items>();
      for (const it of xs) {
        const key = it.type;
        const list = m.get(key) ?? [];
        list.push(it);
        m.set(key, list);
      }
      return [...m.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([type, rows]) => ({
          type,
          rows,
          totalCOP: rows
            .reduce((acc, r) => acc + Number(r.amountCOP), 0)
            .toFixed(0),
        }));
    };

    return {
      items,
      fixed,
      variable,
      fixedByType: groupByType(fixed),
      variableByType: groupByType(variable),
      totals: {
        fixedCOP: sum(fixed).toFixed(0),
        variableCOP: sum(variable).toFixed(0),
        totalCOP: (sum(fixed) + sum(variable)).toFixed(0),
      },
    };
  }

  async upsert(dto: UpsertGastoDto) {
    const period = dto.period ?? GastoPeriod.MONTHLY;
    const row = await this.prisma.gasto.upsert({
      where: { kind_type: { kind: dto.kind, type: dto.type } },
      create: {
        kind: dto.kind,
        type: dto.type,
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
      type: row.type,
      name: row.name,
      period: row.period,
      amountCOP: row.amountCOP.toFixed(0),
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async remove(kind: GastoKind, type: GastoType) {
    await this.prisma.gasto.delete({
      where: { kind_type: { kind, type } },
    });
    return { ok: true };
  }
}

