import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, RecipeCostKind } from '@prisma/client';
import { Pool } from 'pg';
import { LOT_PREFIX } from './lib/sheet-recipe-seed';

/**
 * 1) Pasa `recipe_ingredients` ligados a inventario de costeo (categoría
 *    "Recetas (costeo)" o lote `seed:receta:…`) a filas en `costos`.
 * 2) Intenta colocar en `costos` inventario huérfano del mismo tipo cuyo nombre
 *    sea `Concepto — Nombre producto` si existe un producto con ese nombre.
 * 3) Archiva (`deleted_at`) todo inventario que siga en esa categoría o con ese lote.
 *
 * Después ejecuta: `npm run db:seed-menu-recipes` para alinear con las hojas TS.
 *
 *   npx ts-node --transpile-only scripts/migrate-recipe-costs-to-costos.ts
 */

function sheetCostFromSupplier(s: string | null): string | null {
  if (!s?.trim()) return null;
  const sep = ' | Cantidad (hoja): ';
  const i = s.indexOf(sep);
  if (i === -1) {
    return s.replace(/^Costo unitario \(hoja\):\s*/i, '').trim() || null;
  }
  const head = s
    .slice(0, i)
    .replace(/^Costo unitario \(hoja\):\s*/i, '')
    .trim();
  return head || null;
}

function kindFromStoredLine(unit: string): RecipeCostKind {
  return unit === 'porción' ? RecipeCostKind.FIJO : RecipeCostKind.VARIABLE;
}

/** Separa "Administración (30%) — Café" → concepto + sufijo producto. */
function parseCompoundInventoryName(full: string): {
  concept: string;
  productSuffix: string | null;
} {
  const normalized = full.replace(/\s+/g, ' ').trim();
  const m = normalized.match(/^(.+?)\s*[—–-]\s*(.+)$/);
  if (!m) return { concept: normalized, productSuffix: null };
  return { concept: m[1].trim(), productSuffix: m[2].trim() };
}

function costNameForRow(
  invName: string,
  productName: string | null,
): string {
  const { concept, productSuffix } = parseCompoundInventoryName(invName);
  if (
    productSuffix &&
    productName &&
    productSuffix.toLowerCase() === productName.toLowerCase()
  ) {
    return concept;
  }
  return invName;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const linked = await prisma.recipeIngredient.findMany({
      where: {
        OR: [
          { inventoryItem: { category: { name: 'Recetas (costeo)' } } },
          { inventoryItem: { lot: { startsWith: LOT_PREFIX } } },
        ],
      },
      include: {
        inventoryItem: { include: { category: true } },
        recipe: { include: { product: { select: { name: true } } } },
      },
      orderBy: { id: 'asc' },
    });

    let created = 0;
    let deletedRi = 0;
    const invIds = new Set<string>();

    if (linked.length > 0) {
      const byRecipe = new Map<string, typeof linked>();
      for (const r of linked) {
        const list = byRecipe.get(r.recipeId) ?? [];
        list.push(r);
        byRecipe.set(r.recipeId, list);
      }

      for (const [, list] of byRecipe) {
        let order = 0;
        for (const ri of list) {
          const inv = ri.inventoryItem;
          const pName = ri.recipe.product?.name ?? null;
          const qty = new Prisma.Decimal(ri.quantity);
          const kind = kindFromStoredLine(ri.unit);
          const lineTotal = qty.mul(inv.unitCost);
          const quantityOut =
            kind === RecipeCostKind.VARIABLE ? qty : null;

          await prisma.recipeCost.create({
            data: {
              recipeId: ri.recipeId,
              kind,
              name: costNameForRow(inv.name, pName),
              quantity: quantityOut,
              unit: ri.unit,
              lineTotalCOP: lineTotal,
              sheetUnitCost: sheetCostFromSupplier(inv.supplier),
              sortOrder: order++,
            },
          });
          created++;

          await prisma.recipeIngredient.delete({ where: { id: ri.id } });
          deletedRi++;
          invIds.add(inv.id);
        }
      }

      for (const id of invIds) {
        await prisma.inventory.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      }
    }

    const orphanInv = await prisma.inventory.findMany({
      where: {
        deletedAt: null,
        recipeIngredients: { none: {} },
        OR: [
          { category: { name: 'Recetas (costeo)' } },
          { lot: { startsWith: LOT_PREFIX } },
        ],
      },
      select: {
        id: true,
        name: true,
        unit: true,
        unitCost: true,
      },
    });

    let orphanCosts = 0;
    for (const inv of orphanInv) {
      const { productSuffix } = parseCompoundInventoryName(inv.name);
      if (!productSuffix) continue;

      const product = await prisma.product.findFirst({
        where: {
          name: { equals: productSuffix, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true, name: true },
      });
      if (!product) continue;

      const recipe = await prisma.recipe.findUnique({
        where: { productId: product.id },
        select: { id: true },
      });
      if (!recipe) continue;

      const maxSort = await prisma.recipeCost.aggregate({
        where: { recipeId: recipe.id },
        _max: { sortOrder: true },
      });
      const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
      const kind = inv.unit === 'porción' ? RecipeCostKind.FIJO : RecipeCostKind.VARIABLE;
      const lineTotal =
        kind === RecipeCostKind.FIJO
          ? inv.unitCost
          : new Prisma.Decimal(10000).mul(inv.unitCost);

      await prisma.recipeCost.create({
        data: {
          recipeId: recipe.id,
          kind,
          name: costNameForRow(inv.name, product.name),
          quantity:
            kind === RecipeCostKind.VARIABLE
              ? new Prisma.Decimal(10000)
              : null,
          unit: inv.unit,
          lineTotalCOP: lineTotal,
          sheetUnitCost: null,
          sortOrder,
        },
      });
      orphanCosts++;

      await prisma.inventory.update({
        where: { id: inv.id },
        data: { deletedAt: new Date() },
      });
    }

    const purge = await prisma.inventory.updateMany({
      where: {
        deletedAt: null,
        OR: [
          { category: { name: 'Recetas (costeo)' } },
          { lot: { startsWith: LOT_PREFIX } },
        ],
      },
      data: { deletedAt: new Date() },
    });

    const cat = await prisma.category.findUnique({
      where: { name: 'Recetas (costeo)' },
      select: { id: true },
    });
    if (cat) {
      const active = await prisma.inventory.count({
        where: { categoryId: cat.id, deletedAt: null },
      });
      if (active === 0) {
        await prisma.category.delete({ where: { id: cat.id } }).catch(() => {
          console.warn('No se pudo borrar categoría vacía Recetas (costeo).');
        });
      }
    }

    console.log(
      `Migración: ${created} costos desde recipe_ingredients (${deletedRi} RI borrados), ${orphanCosts} costos desde inventario huérfano, inventario archivado adicional: ${purge.count}.`,
    );
    if (linked.length === 0 && orphanCosts === 0 && purge.count === 0) {
      console.log('(Sin filas legacy; puedes ir directo a db:seed-menu-recipes.)');
    } else {
      console.log('Siguiente paso recomendado: npm run db:seed-menu-recipes');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
