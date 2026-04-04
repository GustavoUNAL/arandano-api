import 'dotenv/config';
import { Pool } from 'pg';

/**
 * Vacía por completo `products` (no solo soft-delete). Usa TRUNCATE en SQL
 * para no depender del adapter de Prisma y dejar siempre 0 filas.
 *
 * Desvincula `sale_lines.product_id`, luego trunca recetas, carritos y productos.
 *
 * Uso (desde la raíz del repo, con tu .env):
 *   npm run db:empty-products
 */

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const masked = url.replace(/:[^:@/]+@/, ':****@');
  console.log('Base de datos:', masked);

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const nullLines = await client.query(
      `UPDATE sale_lines SET product_id = NULL WHERE product_id IS NOT NULL`,
    );
    console.log('sale_lines: product_id anulado en', nullLines.rowCount ?? 0, 'filas');

    await client.query(`
      TRUNCATE TABLE
        recipe_ingredients,
        recipes,
        cart_items,
        products
      RESTART IDENTITY CASCADE
    `);
    console.log('TRUNCATE: recipe_ingredients, recipes, cart_items, products');

    await client.query('COMMIT');

    const check = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM products`,
    );
    console.log('Filas en products ahora:', check.rows[0].n);
    if (check.rows[0].n !== '0') {
      throw new Error('La tabla products no quedó vacía');
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
