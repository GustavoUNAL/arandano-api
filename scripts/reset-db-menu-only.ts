import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { CategoryType, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Vacía todas las tablas de la aplicación y deja solo las 7 categorías PRODUCT de menú
 * (nombres en español, como en Prisma Studio).
 *
 * No borra `_prisma_migrations`.
 *
 * Después ejecuta: npm run db:sync-products
 *
 * Uso: npx ts-node --transpile-only scripts/reset-db-menu-only.ts
 */

const MENU_CATEGORY_NAMES = [
  'Cafetería',
  'Bar',
  'Cócteles',
  'Shots',
  'Botellas',
  'Comida',
  'Combos',
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        "payments",
        "sale_lines",
        "sales",
        "stock_movements",
        "cart_items",
        "carts",
        "costos",
        "recipe_ingredients",
        "recipes",
        "products",
        "partner_contributions",
        "partners",
        "inventory",
        "expenses",
        "tasks",
        "users",
        "categories"
      RESTART IDENTITY CASCADE;
    `);

    for (const name of MENU_CATEGORY_NAMES) {
      await prisma.category.create({
        data: {
          name,
          type: CategoryType.PRODUCT,
        },
      });
    }

    console.log('Base vaciada. Categorías PRODUCT:', MENU_CATEGORY_NAMES.join(', '));
    console.log('Siguiente paso: npm run db:sync-products');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
