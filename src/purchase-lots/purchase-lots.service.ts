import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  inventoryStockValueForLotCode,
  syncPurchaseLotItemCountFromInventory,
} from '../common/sync-purchase-lot-aggregates';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePurchaseLotDto } from './dto/update-purchase-lot.dto';

type ListParams = {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class PurchaseLotsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recalcula `purchase_lots.item_count` desde inventario activo (`inventory.lot` = code).
   * Llamar tras crear/editar/borrar ítems de inventario que usan ese lote.
   */
  async syncInventoryItemCountForLotCode(
    code: string | null | undefined,
  ): Promise<void> {
    await syncPurchaseLotItemCountFromInventory(this.prisma, code);
  }

  /**
   * Garantiza fila en `purchase_lots` para el código (FK desde `inventory.lot`).
   * Si ya existe, no modifica datos de la compra.
   */
  async ensurePurchaseLotRowForCode(
    code: string,
    options?: { supplier?: string | null; purchaseDate?: Date },
  ): Promise<void> {
    const c = code.trim();
    if (!c) return;
    await this.prisma.purchaseLot.upsert({
      where: { code: c },
      create: {
        code: c,
        purchaseDate: options?.purchaseDate ?? new Date(),
        supplier: options?.supplier?.trim() || null,
      },
      update: {},
    });
  }

  /** Primer proveedor no vacío en inventario por código de lote (ítems activos). */
  private async supplierFromInventoryByCode(
    codes: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const trimmed = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    if (!trimmed.length) return map;

    const rows = await this.prisma.inventory.findMany({
      where: {
        deletedAt: null,
        lot: { in: trimmed },
        supplier: { not: null },
      },
      select: { lot: true, supplier: true },
      orderBy: { updatedAt: 'desc' },
    });

    for (const r of rows) {
      const code = r.lot?.trim();
      const s = r.supplier?.trim();
      if (code && s && !map.has(code)) {
        map.set(code, s);
      }
    }
    return map;
  }

  private withResolvedSupplier<
    T extends { code: string; supplier: string | null },
  >(row: T, fallback: Map<string, string>) {
    const fromLot = row.supplier?.trim() || null;
    const resolved = fromLot || fallback.get(row.code.trim()) || null;
    return { ...row, supplierResolved: resolved };
  }

  async findAll(params: ListParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const and: Prisma.PurchaseLotWhereInput[] = [];
    const search = params.search?.trim();
    if (search?.length) {
      and.push({
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
          { supplier: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const purchaseDate: Prisma.DateTimeFilter = {};
    if (params.dateFrom?.trim()) {
      purchaseDate.gte = new Date(params.dateFrom.trim());
    }
    if (params.dateTo?.trim()) {
      const end = new Date(params.dateTo.trim());
      end.setHours(23, 59, 59, 999);
      purchaseDate.lte = end;
    }
    if (Object.keys(purchaseDate).length > 0) {
      and.push({ purchaseDate });
    }

    const where: Prisma.PurchaseLotWhereInput =
      and.length === 0 ? {} : { AND: and };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.purchaseLot.count({ where }),
      this.prisma.purchaseLot.findMany({
        where,
        skip,
        take: limit,
        orderBy: { purchaseDate: 'desc' },
      }),
    ]);

    const fallback = await this.supplierFromInventoryByCode(
      data.map((d) => d.code),
    );

    const codes = data.map((d) => d.code);
    const grouped =
      codes.length > 0
        ? await this.prisma.inventory.groupBy({
            by: ['lot'],
            where: { deletedAt: null, lot: { in: codes } },
            _count: { id: true },
          })
        : [];
    const linkedCountByCode = new Map(
      grouped.map((g) => [g.lot as string, g._count.id]),
    );

    return {
      data: data.map((d) => ({
        ...this.withResolvedSupplier(d, fallback),
        linkedActiveItemCount: linkedCountByCode.get(d.code) ?? 0,
      })),
      meta: { page, limit, total, hasNextPage: skip + data.length < total },
    };
  }

  /** Proveedores distintos en lotes de compra e ítems de inventario. */
  async listDistinctSuppliers() {
    const [fromLots, fromInventory] = await this.prisma.$transaction([
      this.prisma.purchaseLot.findMany({
        where: { supplier: { not: null } },
        select: { supplier: true },
        distinct: ['supplier'],
      }),
      this.prisma.inventory.findMany({
        where: { deletedAt: null, supplier: { not: null } },
        select: { supplier: true },
        distinct: ['supplier'],
      }),
    ]);

    const names = new Set<string>();
    for (const r of fromLots) {
      const s = r.supplier?.trim();
      if (s) names.add(s);
    }
    for (const r of fromInventory) {
      const s = r.supplier?.trim();
      if (s) names.add(s);
    }

    return {
      suppliers: [...names].sort((a, b) => a.localeCompare(b, 'es')),
      counts: {
        distinctFromPurchaseLots: fromLots.length,
        distinctFromInventory: fromInventory.length,
      },
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.purchaseLot.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Purchase lot not found');
    }
    const fallback = await this.supplierFromInventoryByCode([row.code]);
    const base = this.withResolvedSupplier(row, fallback);
    const { activeItemCount, stockValueCOP } =
      await inventoryStockValueForLotCode(this.prisma, row.code);

    return {
      ...base,
      inventoryLink: {
        lotCode: row.code,
        activeItemCount,
        stockValueCOP: stockValueCOP.toFixed(0),
        /** Suma qty×unitCost en inventario; `totalValue` del lote es monto de compra. */
        note:
          'inventory.lot debe coincidir con purchase_lots.code. totalValue = monto pagado (compra), no valorización de stock.',
      },
    };
  }

  async update(id: string, dto: UpdatePurchaseLotDto) {
    const existing = await this.prisma.purchaseLot.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Purchase lot not found');
    }

    await this.prisma.purchaseLot.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name || null } : {}),
        ...(dto.purchaseDate !== undefined
          ? { purchaseDate: new Date(dto.purchaseDate) }
          : {}),
        ...(dto.supplier !== undefined ? { supplier: dto.supplier || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.totalValue !== undefined
          ? { totalValue: new Prisma.Decimal(dto.totalValue) }
          : {}),
      },
    });
    return this.findOne(id);
  }
}
