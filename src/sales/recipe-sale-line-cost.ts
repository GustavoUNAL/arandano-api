import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Costo de receta por una unidad vendida (yield = 1 o el `recipeYield` definido).
 * `recipeCostMultiplier` aplica a medias botellas, etc. (p. ej. 0.5).
 */
export async function unitRecipeCostCOP(
  prisma: PrismaClient | Prisma.TransactionClient,
  productId: string,
  recipeCostMultiplier = 1,
): Promise<Prisma.Decimal | null> {
  const recipe = await prisma.recipe.findUnique({
    where: { productId },
    include: {
      ingredients: { include: { inventoryItem: true } },
    },
  });
  if (!recipe?.ingredients.length) return null;

  let total = new Prisma.Decimal(0);
  for (const ing of recipe.ingredients) {
    total = total.add(
      new Prisma.Decimal(ing.quantity).mul(ing.inventoryItem.unitCost),
    );
  }
  const y = recipe.recipeYield.gt(0)
    ? recipe.recipeYield
    : new Prisma.Decimal(1);
  const mult = new Prisma.Decimal(recipeCostMultiplier);
  return total.div(y).mul(mult);
}

export type SaleLineCostResult = {
  costAtSale: Prisma.Decimal | null;
  profit: Prisma.Decimal | null;
};

/**
 * `costAtSale`: costo total de la línea (cantidad × costo unitario de receta × mult).
 * `profit`: ingreso de la línea − costo (`quantity * unitPrice - costAtSale`).
 */
export async function computeSaleLineCostProfit(
  prisma: PrismaClient | Prisma.TransactionClient,
  productId: string,
  quantity: Prisma.Decimal | number | string,
  unitPrice: Prisma.Decimal | number | string,
  recipeCostMultiplier = 1,
): Promise<SaleLineCostResult> {
  const q = new Prisma.Decimal(quantity);
  const up = new Prisma.Decimal(unitPrice);
  const unitCost = await unitRecipeCostCOP(
    prisma,
    productId,
    recipeCostMultiplier,
  );
  if (unitCost == null) {
    return { costAtSale: null, profit: null };
  }
  const costAtSale = unitCost.mul(q);
  const profit = up.mul(q).sub(costAtSale);
  return { costAtSale, profit };
}
