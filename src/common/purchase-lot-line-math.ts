import { Prisma } from '@prisma/client';

const zero = () => new Prisma.Decimal(0);

/**
 * Para migración / backfill: estima cantidad comprada cuando no hay líneas de comprobante.
 * Si hay movimientos IN, se usa su suma; si no, stock actual + salidas (SALE+OUT+WASTE).
 */
export function deriveBackfillQuantityPurchased(
  currentQty: Prisma.Decimal,
  sumIn: Prisma.Decimal,
  sumOutSaleWaste: Prisma.Decimal,
): Prisma.Decimal {
  if (sumIn.gt(0)) return sumIn;
  return currentQty.add(sumOutSaleWaste);
}

/** Consumido en la línea = max(0, comprado − existencia actual). */
export function lineQuantityConsumed(
  quantityPurchased: Prisma.Decimal,
  quantityRemaining: Prisma.Decimal,
): Prisma.Decimal {
  const d = quantityPurchased.sub(quantityRemaining);
  return d.lt(0) ? zero() : d;
}

export function lineTotalFromQtyAndUnitCost(
  qty: Prisma.Decimal,
  unitCost: Prisma.Decimal,
): Prisma.Decimal {
  return qty.mul(unitCost);
}

/** Tolerancia COP para comparar total de factura vs suma de líneas (redondeos). */
export function purchaseTotalsWithinTolerance(
  a: Prisma.Decimal,
  b: Prisma.Decimal,
  toleranceCOP: Prisma.Decimal = new Prisma.Decimal('1'),
): boolean {
  return a.sub(b).abs().lte(toleranceCOP);
}
