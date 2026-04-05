import {
  CategoryType,
  Prisma,
  PrismaClient,
  RecipeCostKind,
} from '@prisma/client';

/** Lógica compartida por los scripts `seed-*-recipes.ts`. */

export const LOT_PREFIX = 'seed:receta';

/** Categoría para insumos físicos enlazados a recetas (no se archiva en cleanup). */
export const INSUMOS_RECETA_CATEGORY = 'Insumos (recetas)';

export type SheetMeasureUnit = 'g' | 'ml' | 'porción' | 'oz' | 'und';

/** Una fila del recetario (Ingrediente / Cantidad / Costo unitario / Costo total). */
export type SheetLine = {
  ingredient: string;
  qty: number | null;
  unit: SheetMeasureUnit;
  sheetUnitCost: string;
  lineTotalCOP: number;
};

export type RecipeSpec = {
  productName: string;
  lines: SheetLine[];
};

export function inventoryLot(productId: string, lineIndex: number): string {
  return `${LOT_PREFIX}:${productId}:L${lineIndex}`;
}

export function recipeIngredientQuantity(line: SheetLine): Prisma.Decimal {
  if (line.qty != null && line.qty > 0) {
    return new Prisma.Decimal(line.qty);
  }
  return new Prisma.Decimal(1);
}

export function recipeIngredientUnit(line: SheetLine): string {
  if (line.qty != null && line.qty > 0) {
    return line.unit;
  }
  return 'porción';
}

function normalizeSheetLabel(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

/** Filas que no deben volcarse a receta ni a costos (solo exclusión real). */
export function isRecipeLineExcludedFromInventory(line: SheetLine): boolean {
  return normalizeSheetLabel(line.ingredient) === 'materia prima';
}

/**
 * Línea de costeo de hoja (indirectos, administración, fijos sin cantidad, etc.).
 * No enlaza inventario físico ni descuenta stock al vender.
 */
export function isRecipeLineCostOnly(line: SheetLine): boolean {
  if (isRecipeLineExcludedFromInventory(line)) return true;
  const n = normalizeSheetLabel(line.ingredient);
  if (n.includes('indirecto')) return true;
  if (n.includes('administracion')) return true;
  return false;
}

/** Insumo con cantidad > 0 que debe enlazarse a inventario y figurar en `recipe_ingredients`. */
export function isRecipeLineMaterial(line: SheetLine): boolean {
  if (isRecipeLineExcludedFromInventory(line)) return false;
  if (isRecipeLineCostOnly(line)) return false;
  return line.qty != null && line.qty > 0;
}

/** Con cantidad > 0 se trata como costo variable; si no, fijo (indirecto por porción). */
export function inferRecipeCostKind(line: SheetLine): RecipeCostKind {
  if (line.qty != null && line.qty > 0) return RecipeCostKind.VARIABLE;
  return RecipeCostKind.FIJO;
}

function supplierNoteForLine(line: SheetLine): string | null {
  const cost =
    line.sheetUnitCost?.trim() && line.sheetUnitCost.trim() !== '—'
      ? line.sheetUnitCost.trim()
      : null;
  if (!cost && (line.qty == null || line.qty <= 0)) return null;
  const qtyPart =
    line.qty != null && line.qty > 0
      ? `${line.qty} ${line.unit}`
      : recipeIngredientUnit(line);
  const head = cost ? `Costo unitario (hoja): ${cost}` : 'Costo unitario (hoja): —';
  return `${head} | Cantidad (hoja): ${qtyPart}`;
}

async function ensureInsumosRecetaCategoryId(
  prisma: PrismaClient,
): Promise<string> {
  const row = await prisma.category.upsert({
    where: { name: INSUMOS_RECETA_CATEGORY },
    create: {
      name: INSUMOS_RECETA_CATEGORY,
      type: CategoryType.INVENTORY,
    },
    update: {},
    select: { id: true },
  });
  return row.id;
}

async function findOrCreateInventoryForMaterialLine(
  prisma: PrismaClient,
  categoryId: string,
  line: SheetLine,
): Promise<string> {
  const name = line.ingredient.trim();
  const unit = recipeIngredientUnit(line);
  const qtyDec = recipeIngredientQuantity(line);

  const hit = await prisma.inventory.findFirst({
    where: {
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
      unit: { equals: unit, mode: 'insensitive' },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (hit) return hit.id;

  const unitCostNum = qtyDec.gt(0)
    ? line.lineTotalCOP / qtyDec.toNumber()
    : line.lineTotalCOP;

  const row = await prisma.inventory.create({
    data: {
      name,
      categoryId,
      quantity: new Prisma.Decimal(0),
      unit,
      unitCost: new Prisma.Decimal(unitCostNum),
      supplier: supplierNoteForLine(line),
      lot: null,
    },
  });
  return row.id;
}

export async function seedRecipeSpecs(
  prisma: PrismaClient,
  specs: RecipeSpec[],
  logLabel: string,
): Promise<number> {
  const insumosCategoryId = await ensureInsumosRecetaCategoryId(prisma);
  let done = 0;

  for (const spec of specs) {
    const product = await prisma.product.findFirst({
      where: { name: spec.productName, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!product) {
      console.warn(`[${logLabel}] Omitido (sin producto): "${spec.productName}"`);
      continue;
    }

    await prisma.recipe.deleteMany({ where: { productId: product.id } });

    const ingredientCreates: {
      inventoryItemId: string;
      quantity: Prisma.Decimal;
      unit: string;
      sortOrder: number;
    }[] = [];
    const costCreates: {
      kind: RecipeCostKind;
      name: string;
      quantity: Prisma.Decimal | null;
      unit: string;
      lineTotalCOP: Prisma.Decimal;
      sheetUnitCost: string | null;
      sortOrder: number;
    }[] = [];

    let sheetOrder = 0;
    for (const line of spec.lines) {
      if (isRecipeLineExcludedFromInventory(line)) continue;

      if (isRecipeLineMaterial(line)) {
        const inventoryItemId = await findOrCreateInventoryForMaterialLine(
          prisma,
          insumosCategoryId,
          line,
        );
        ingredientCreates.push({
          inventoryItemId,
          quantity: recipeIngredientQuantity(line),
          unit: recipeIngredientUnit(line),
          sortOrder: sheetOrder++,
        });
      } else {
        costCreates.push({
          kind: inferRecipeCostKind(line),
          name: line.ingredient,
          quantity:
            line.qty != null && line.qty > 0
              ? new Prisma.Decimal(line.qty)
              : null,
          unit: recipeIngredientUnit(line),
          lineTotalCOP: new Prisma.Decimal(line.lineTotalCOP),
          sheetUnitCost:
            line.sheetUnitCost?.trim() && line.sheetUnitCost.trim() !== '—'
              ? line.sheetUnitCost.trim()
              : null,
          sortOrder: sheetOrder++,
        });
      }
    }

    await prisma.recipe.create({
      data: {
        productId: product.id,
        recipeYield: new Prisma.Decimal('1'),
        ingredients: {
          create: ingredientCreates,
        },
        costs: { create: costCreates },
      },
    });

    console.log(
      `[${logLabel}]`,
      product.name,
      `(${ingredientCreates.length} insumos, ${costCreates.length} costos / ${spec.lines.length} líneas hoja)`,
    );
    done++;
  }

  await softDeleteLegacyRecipeInventory(prisma);
  return done;
}

/** Archiva inventario fantasma de costeo (categoría antigua o lotes seed:receta). */
export async function softDeleteLegacyRecipeInventory(
  prisma: PrismaClient,
): Promise<number> {
  const res = await prisma.inventory.updateMany({
    where: {
      deletedAt: null,
      OR: [
        { category: { name: 'Recetas (costeo)' } },
        { lot: { startsWith: LOT_PREFIX } },
      ],
    },
    data: { deletedAt: new Date() },
  });
  if (res.count > 0) {
    console.log(
      `[cleanup] Inventario de recetas (fantasma) archivado: ${res.count} filas`,
    );
  }

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
        console.warn('[cleanup] No se pudo eliminar categoría vacía Recetas (costeo).');
      });
    }
  }

  return res.count;
}
