import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Borra físicamente filas con soft-delete (`deleted_at` no nulo).
 * Hoy aplica a `products` e `inventory` (único esquema con esa columna).
 *
 * Orden: desbloquea FKs (cart_items, recipe_ingredients, stock_movements, …)
 * y luego DELETE permanente.
 *
 * Uso: npm run db:purge-soft-deleted
 */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const invSoft = await prisma.inventory.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true },
    });
    const invIds = invSoft.map((r) => r.id);

    if (invIds.length > 0) {
      const ri = await prisma.recipeIngredient.deleteMany({
        where: { inventoryItemId: { in: invIds } },
      });
      const sm = await prisma.stockMovement.deleteMany({
        where: { inventoryItemId: { in: invIds } },
      });
      const pc = await prisma.partnerContribution.updateMany({
        where: { inventoryItemId: { in: invIds } },
        data: { inventoryItemId: null },
      });
      const inv = await prisma.inventory.deleteMany({
        where: { id: { in: invIds } },
      });
      console.log(
        'Inventory (deleted_at):',
        `recipe_ingredients ${ri.count}, stock_movements ${sm.count}, partner_contributions null ${pc.count}, filas ${inv.count}`,
      );
    } else {
      console.log('Inventory (deleted_at): 0 filas');
    }

    const ci = await prisma.cartItem.deleteMany({
      where: { product: { deletedAt: { not: null } } },
    });
    const prod = await prisma.product.deleteMany({
      where: { deletedAt: { not: null } },
    });
    console.log(
      'Products (deleted_at):',
      `cart_items ${ci.count}, productos ${prod.count}`,
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
