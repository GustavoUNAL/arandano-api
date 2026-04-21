/**
 * Tras desplegar código nuevo sin aplicar migraciones, Prisma devuelve P2021
 * si la tabla `purchase_lot_lines` aún no existe.
 */
export function isMissingPurchaseLotLinesTableError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: string; meta?: { modelName?: string } };
  return (
    e.code === 'P2021' && e.meta?.modelName === 'PurchaseLotLine'
  );
}
