import { CategoryType, Prisma, PrismaClient } from '@prisma/client';

/** Lógica compartida por los scripts `seed-*-recipes.ts`. */

export const LOT_PREFIX = 'seed:receta';

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

export function inventoryUnitCost(line: SheetLine): Prisma.Decimal {
  const total = new Prisma.Decimal(line.lineTotalCOP);
  if (line.qty != null && line.qty > 0) {
    return total.div(line.qty);
  }
  return total;
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

export function inventoryStockUnit(line: SheetLine): string {
  if (line.qty != null && line.qty > 0) {
    return line.unit;
  }
  return 'porción';
}

export function recipeLineSupplier(line: SheetLine): string {
  const qtyPart =
    line.qty != null && line.qty > 0 ? `${line.qty} ${line.unit}` : '—';
  return `Costo unitario (hoja): ${line.sheetUnitCost} | Cantidad (hoja): ${qtyPart}`;
}

export async function ensureInventoryCategory(
  prisma: PrismaClient,
): Promise<string> {
  const row = await prisma.category.upsert({
    where: { name: 'Materia prima' },
    create: { name: 'Materia prima', type: CategoryType.INVENTORY },
    update: {},
    select: { id: true },
  });
  return row.id;
}

export async function upsertRecipeLineInventory(
  prisma: PrismaClient,
  categoryId: string,
  productId: string,
  lineIndex: number,
  line: SheetLine,
): Promise<string> {
  const lot = inventoryLot(productId, lineIndex);
  const unitCost = inventoryUnitCost(line);
  const stockUnit = inventoryStockUnit(line);
  const supplier = recipeLineSupplier(line);

  const existing = await prisma.inventory.findFirst({
    where: { lot, deletedAt: null },
    select: { id: true },
  });

  const data = {
    name: line.ingredient,
    categoryId,
    quantity: new Prisma.Decimal('10000'),
    unit: stockUnit,
    unitCost,
    supplier,
    lot,
  };

  if (existing) {
    await prisma.inventory.update({
      where: { id: existing.id },
      data,
    });
    return existing.id;
  }

  const row = await prisma.inventory.create({ data });
  return row.id;
}

export async function seedRecipeSpecs(
  prisma: PrismaClient,
  invCategoryId: string,
  specs: RecipeSpec[],
  logLabel: string,
): Promise<number> {
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

    const ingredientCreates: Prisma.RecipeIngredientCreateWithoutRecipeInput[] =
      [];

    for (let i = 0; i < spec.lines.length; i++) {
      const line = spec.lines[i];
      const inventoryItemId = await upsertRecipeLineInventory(
        prisma,
        invCategoryId,
        product.id,
        i,
        line,
      );
      ingredientCreates.push({
        inventoryItem: { connect: { id: inventoryItemId } },
        quantity: recipeIngredientQuantity(line),
        unit: recipeIngredientUnit(line),
      });
    }

    await prisma.recipe.create({
      data: {
        productId: product.id,
        recipeYield: new Prisma.Decimal('1'),
        ingredients: { create: ingredientCreates },
      },
    });

    console.log(`[${logLabel}]`, product.name, `(${spec.lines.length} líneas)`);
    done++;
  }
  return done;
}
