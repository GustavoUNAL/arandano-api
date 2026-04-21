/**
 * Crea `purchase_lot_lines` desde inventario activo con `lot` (una línea por ítem).
 * Congela cantidad comprada estimada y costos según movimientos + stock actual.
 *
 *   npx ts-node --transpile-only scripts/backfill-purchase-lot-lines-from-inventory.ts
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, StockMovementType } from '@prisma/client';
import { Pool } from 'pg';
import {
  deriveBackfillQuantityPurchased,
  lineTotalFromQtyAndUnitCost,
} from '../src/common/purchase-lot-line-math';

const zero = () => new Prisma.Decimal(0);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const items = await prisma.inventory.findMany({
      where: { deletedAt: null, lot: { not: null } },
      select: {
        id: true,
        lot: true,
        name: true,
        categoryId: true,
        quantity: true,
        unit: true,
        unitCost: true,
      },
    });

    if (!items.length) {
      console.log('Sin ítems de inventario con lote; nada que hacer.');
      return;
    }

    const ids = items.map((i) => i.id);
    const sumsRows = await prisma.stockMovement.groupBy({
      by: ['inventoryItemId', 'type'],
      where: { inventoryItemId: { in: ids } },
      _sum: { quantity: true },
    });

    const sumsMap = new Map<
      string,
      { IN: Prisma.Decimal; OUT: Prisma.Decimal; SALE: Prisma.Decimal; WASTE: Prisma.Decimal }
    >();

    const ensure = (id: string) => {
      let m = sumsMap.get(id);
      if (!m) {
        m = { IN: zero(), OUT: zero(), SALE: zero(), WASTE: zero() };
        sumsMap.set(id, m);
      }
      return m;
    };

    for (const r of sumsRows) {
      const q = r._sum.quantity ?? zero();
      const slot = ensure(r.inventoryItemId);
      if (r.type === StockMovementType.IN) slot.IN = slot.IN.add(q);
      if (r.type === StockMovementType.OUT) slot.OUT = slot.OUT.add(q);
      if (r.type === StockMovementType.SALE) slot.SALE = slot.SALE.add(q);
      if (r.type === StockMovementType.WASTE) slot.WASTE = slot.WASTE.add(q);
    }

    let created = 0;
    let skipped = 0;

    for (const inv of items) {
      const lot = inv.lot?.trim();
      if (!lot) continue;

      const existing = await prisma.purchaseLotLine.findUnique({
        where: { inventoryItemId: inv.id },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const sums = sumsMap.get(inv.id) ?? {
        IN: zero(),
        OUT: zero(),
        SALE: zero(),
        WASTE: zero(),
      };
      const sumOutSaleWaste = sums.OUT.add(sums.SALE).add(sums.WASTE);
      const qtyPurchased = deriveBackfillQuantityPurchased(
        inv.quantity,
        sums.IN,
        sumOutSaleWaste,
      );
      const lineTotal = lineTotalFromQtyAndUnitCost(qtyPurchased, inv.unitCost);

      await prisma.purchaseLotLine.create({
        data: {
          purchaseLotCode: lot,
          inventoryItemId: inv.id,
          lineName: inv.name,
          categoryId: inv.categoryId,
          quantityPurchased: qtyPurchased,
          unit: inv.unit,
          purchaseUnitCostCOP: inv.unitCost,
          lineTotalCOP: lineTotal,
          sortOrder: 0,
        },
      });
      created++;
    }

    console.log(
      `OK: líneas creadas=${created}, ya existían (omitidos)=${skipped}, inventario con lote=${items.length}.`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
