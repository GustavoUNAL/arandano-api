import { Prisma, PrismaClient } from '@prisma/client';

type LotSyncDb = Pick<PrismaClient, 'purchaseLot' | 'inventory'>;

/**
 * Actualiza `purchase_lots.item_count` según filas activas de `inventory` con
 * `inventory.lot` = `purchase_lots.code`.
 *
 * No modifica `total_value`: ese campo refleja el monto pagado en la compra
 * (factura / registro financiero), no la valorización Σ(qty×unitCost) del stock.
 */
export async function syncPurchaseLotItemCountFromInventory(
  prisma: LotSyncDb,
  code: string | null | undefined,
): Promise<void> {
  const c = code?.trim();
  if (!c) return;

  const lotRow = await prisma.purchaseLot.findUnique({
    where: { code: c },
    select: { code: true },
  });
  if (!lotRow) return;

  const items = await prisma.inventory.findMany({
    where: { lot: c, deletedAt: null },
    select: { id: true },
  });

  await prisma.purchaseLot.update({
    where: { code: c },
    data: { itemCount: items.length },
  });
}

type InventoryDb = Pick<PrismaClient, 'inventory'>;

/** Valorización aproximada del stock enlazado al lote (Σ cantidad × costo unitario). */
export async function inventoryStockValueForLotCode(
  prisma: InventoryDb,
  code: string,
): Promise<{ activeItemCount: number; stockValueCOP: Prisma.Decimal }> {
  const items = await prisma.inventory.findMany({
    where: { lot: code, deletedAt: null },
    select: { quantity: true, unitCost: true },
  });
  let stockValueCOP = new Prisma.Decimal(0);
  for (const it of items) {
    stockValueCOP = stockValueCOP.add(it.quantity.mul(it.unitCost));
  }
  return {
    activeItemCount: items.length,
    stockValueCOP,
  };
}
