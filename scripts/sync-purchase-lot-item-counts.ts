/**
 * Recalcula `purchase_lots.item_count` para todos los lotes desde inventario activo.
 *
 *   npx ts-node --transpile-only scripts/sync-purchase-lot-item-counts.ts
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { syncPurchaseLotItemCountFromInventory } from '../src/common/sync-purchase-lot-aggregates';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const lots = await prisma.purchaseLot.findMany({ select: { code: true } });
    let n = 0;
    for (const { code } of lots) {
      await syncPurchaseLotItemCountFromInventory(prisma, code);
      n++;
    }
    console.log(`OK: sincronizado item_count para ${n} lotes.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
