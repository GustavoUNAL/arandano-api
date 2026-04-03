import { Prisma, StockMovementType } from '@prisma/client';

export type SaleLineForInventory = {
  productId: string;
  quantity: number;
};

export async function applySaleInventoryImpact(
  tx: Prisma.TransactionClient,
  saleId: string,
  lines: SaleLineForInventory[],
): Promise<void> {
  for (const line of lines) {
    const q = line.quantity;
    if (q <= 0) continue;

    const recipe = await tx.recipe.findUnique({
      where: { productId: line.productId },
      include: { ingredients: true },
    });
    if (!recipe) continue;

    const yieldQty = new Prisma.Decimal(recipe.recipeYield);
    const divisor = yieldQty.gt(0) ? yieldQty : new Prisma.Decimal(1);

    for (const ing of recipe.ingredients) {
      const used = new Prisma.Decimal(ing.quantity).div(divisor).mul(q);
      if (used.lte(0)) continue;

      await tx.inventory.update({
        where: { id: ing.inventoryItemId },
        data: { quantity: { decrement: used } },
      });

      await tx.stockMovement.create({
        data: {
          inventoryItemId: ing.inventoryItemId,
          type: StockMovementType.SALE,
          quantity: used,
          unit: ing.unit,
          movementDate: new Date(),
          saleId,
        },
      });
    }
  }
}
