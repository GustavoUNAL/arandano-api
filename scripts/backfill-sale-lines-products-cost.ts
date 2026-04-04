import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { matchSaleLineToCatalog, normalizeProductLabel } from './lib/sale-line-product-match';
import { computeSaleLineCostProfit } from '../src/sales/recipe-sale-line-cost';

/**
 * Enlaza cada `sale_line` a un `product_id` del menú actual y rellena
 * `cost_at_sale` / `profit` según la receta vigente (× multiplicador para medias).
 *
 * No borra ventas: solo actualiza líneas. Líneas sin producto en catálogo se omiten.
 *
 * Uso: npm run db:backfill-sale-lines
 */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const nameToId = new Map<string, { id: string; name: string }>();
    for (const p of products) {
      nameToId.set(normalizeProductLabel(p.name), p);
    }

    const lines = await prisma.saleLine.findMany({
      select: {
        id: true,
        productName: true,
        productId: true,
        quantity: true,
        unitPrice: true,
      },
    });

    let updated = 0;
    let skipped = 0;
    let noRecipe = 0;

    for (const line of lines) {
      const hit = matchSaleLineToCatalog(line.productName, nameToId);
      if (!hit) {
        skipped++;
        continue;
      }

      const { costAtSale, profit } = await computeSaleLineCostProfit(
        prisma,
        hit.productId,
        line.quantity,
        line.unitPrice,
        hit.recipeCostMultiplier,
      );

      if (costAtSale == null) noRecipe++;

      await prisma.saleLine.update({
        where: { id: line.id },
        data: {
          productId: hit.productId,
          costAtSale,
          profit,
        },
      });
      updated++;
    }

    console.log(
      `Líneas actualizadas: ${updated} (sin receta/costo: ${noRecipe}), sin match catálogo: ${skipped}, total: ${lines.length}`,
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
