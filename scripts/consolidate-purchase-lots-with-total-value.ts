import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { syncPurchaseLotItemCountFromInventory } from '../src/common/sync-purchase-lot-aggregates';

const FALLBACK_LOT_CODE = 'CONSOLIDADO-SIN-COSTO-202604';

type InvRow = {
  id: string;
  name: string;
  lot: string | null;
  supplier: string | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
};

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [lots, inventory] = await Promise.all([
      prisma.purchaseLot.findMany({
        select: { code: true, supplier: true, totalValue: true, purchaseDate: true },
      }),
      prisma.inventory.findMany({
        // Incluye activos y archivados para poder eliminar lotes no válidos
        // sin violar FK RESTRICT desde inventory.lot -> purchase_lots.code.
        select: {
          id: true,
          name: true,
          lot: true,
          supplier: true,
          quantity: true,
          unitCost: true,
        },
      }),
    ]);

    const validLots = lots.filter((l) => l.totalValue && l.totalValue.gt(0));
    const validByCode = new Map(validLots.map((l) => [l.code, l]));

    const updates: Array<{ id: string; from: string | null; to: string }> = [];
    const fallbackAssigned: InvRow[] = [];

    for (const item of inventory) {
      const current = item.lot?.trim() ?? '';
      if (current && validByCode.has(current)) continue;

      let best: { code: string; score: number } | null = null;
      for (const lot of validLots) {
        let score = 0;
        const invSup = norm(item.supplier);
        const lotSup = norm(lot.supplier);
        if (invSup && lotSup) {
          if (invSup === lotSup) score = 100;
          else if (lotSup.includes(invSup) || invSup.includes(lotSup)) score = 70;
          else {
            const a = new Set(invSup.split(' ').filter(Boolean));
            const b = new Set(lotSup.split(' ').filter(Boolean));
            const inter = [...a].filter((x) => b.has(x)).length;
            if (inter) score = 30 + inter;
          }
        }

        if (!score && current) {
          const c = norm(current);
          const code = norm(lot.code);
          if (c && code && (c.includes(code) || code.includes(c))) score = Math.max(score, 25);
        }

        if (!best || score > best.score) best = { code: lot.code, score };
      }

      const target = best && best.score > 0 ? best.code : FALLBACK_LOT_CODE;
      updates.push({ id: item.id, from: item.lot, to: target });
      if (target === FALLBACK_LOT_CODE) fallbackAssigned.push(item);
    }

    const fallbackStockValue = fallbackAssigned.reduce(
      (acc, r) => acc.add(r.quantity.mul(r.unitCost)),
      new Prisma.Decimal(0),
    );

    const nonValidCodes = lots
      .filter((l) => !(l.totalValue && l.totalValue.gt(0)))
      .map((l) => l.code)
      .filter((c) => c !== FALLBACK_LOT_CODE);

    console.log(
      JSON.stringify(
        {
          dryRun,
          lotsTotal: lots.length,
          lotsWithTotal: validLots.length,
          toReassignInventoryItems: updates.length,
          fallbackAssigned: fallbackAssigned.length,
          lotsToDeleteAfterReassign: nonValidCodes.length,
        },
        null,
        2,
      ),
    );

    if (dryRun) return;

    await prisma.$transaction(
      async (tx) => {
        if (fallbackAssigned.length > 0) {
          await tx.purchaseLot.upsert({
            where: { code: FALLBACK_LOT_CODE },
            create: {
              code: FALLBACK_LOT_CODE,
              name: 'Lote consolidado (sin costo histórico por lote)',
              purchaseDate: new Date(),
              supplier: 'Consolidado automático',
              notes:
                'Creado para consolidar ítems que estaban en lotes sin totalValue; totalValue aproximado desde stock actual.',
              totalValue: fallbackStockValue.toDecimalPlaces(0),
            },
            update: {
              totalValue: fallbackStockValue.toDecimalPlaces(0),
              notes:
                'Consolidado automático para ítems originalmente en lotes sin totalValue.',
            },
          });
        }

        for (const u of updates) {
          await tx.inventory.update({
            where: { id: u.id },
            data: { lot: u.to },
          });
        }

        if (nonValidCodes.length > 0) {
          const referencedLots = await tx.inventory.findMany({
            where: { lot: { in: nonValidCodes } },
            select: { lot: true },
            distinct: ['lot'],
          });
          const referencedSet = new Set(
            referencedLots
              .map((r) => r.lot?.trim())
              .filter((x): x is string => !!x),
          );
          const deletable = nonValidCodes.filter((c) => !referencedSet.has(c));
          if (deletable.length > 0) {
            await tx.purchaseLot.deleteMany({ where: { code: { in: deletable } } });
          }
        }
      },
      { maxWait: 20_000, timeout: 120_000 },
    );

    const finalLots = await prisma.purchaseLot.findMany({ select: { code: true } });
    for (const lot of finalLots) {
      await syncPurchaseLotItemCountFromInventory(prisma, lot.code);
    }

    console.log(
      `OK: ítems reasignados ${updates.length}, lotes finales ${finalLots.length}, fallback ${fallbackAssigned.length}.`,
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
