/**
 * Rellena `purchase_lots.supplier` cuando está vacío, tomando un proveedor
 * representativo de `inventory` (mismo `lot` = `purchase_lots.code`, ítems activos).
 *
 *   npx ts-node --transpile-only scripts/backfill-purchase-lot-suppliers-from-inventory.ts
 *   npx ts-node --transpile-only scripts/backfill-purchase-lot-suppliers-from-inventory.ts --dry-run
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

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
    const lots = await prisma.purchaseLot.findMany({
      select: { id: true, code: true, supplier: true },
    });
    const targets = lots.filter((l) => !l.supplier?.trim());
    console.log(
      `Lotes sin proveedor: ${targets.length} / ${lots.length}${dryRun ? ' (dry-run)' : ''}`,
    );

    let updated = 0;
    for (const lot of targets) {
      const inv = await prisma.inventory.findFirst({
        where: {
          lot: lot.code,
          deletedAt: null,
          supplier: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
        select: { supplier: true },
      });
      const s = inv?.supplier?.trim();
      if (!s) continue;
      if (dryRun) {
        console.log(`  [dry-run] ${lot.code} <- "${s}"`);
        updated++;
        continue;
      }
      await prisma.purchaseLot.update({
        where: { id: lot.id },
        data: { supplier: s },
      });
      updated++;
    }
    console.log(
      dryRun
        ? `Simulación: se habrían actualizado ${updated} lotes.`
        : `OK: actualizados ${updated} lotes con proveedor desde inventario.`,
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
