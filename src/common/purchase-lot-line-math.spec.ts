import { Prisma } from '@prisma/client';
import {
  deriveBackfillQuantityPurchased,
  lineQuantityConsumed,
  lineTotalFromQtyAndUnitCost,
  purchaseTotalsWithinTolerance,
} from './purchase-lot-line-math';

describe('purchase-lot-line-math', () => {
  it('deriveBackfillQuantityPurchased usa sum(IN) cuando hay entradas', () => {
    const q = deriveBackfillQuantityPurchased(
      new Prisma.Decimal(3),
      new Prisma.Decimal(20),
      new Prisma.Decimal(100),
    );
    expect(q.toString()).toBe('20');
  });

  it('deriveBackfillQuantityPurchased usa stock + salidas si no hay IN', () => {
    const q = deriveBackfillQuantityPurchased(
      new Prisma.Decimal(4),
      new Prisma.Decimal(0),
      new Prisma.Decimal(6),
    );
    expect(q.toString()).toBe('10');
  });

  it('lineQuantityConsumed no baja de cero', () => {
    expect(
      lineQuantityConsumed(new Prisma.Decimal(5), new Prisma.Decimal(10)).toString(),
    ).toBe('0');
    expect(
      lineQuantityConsumed(new Prisma.Decimal(10), new Prisma.Decimal(3)).toString(),
    ).toBe('7');
  });

  it('lineTotalFromQtyAndUnitCost es estable ante descuentos de stock (solo referencia de cálculo)', () => {
    const purchased = new Prisma.Decimal(100);
    const unit = new Prisma.Decimal('2500.5');
    const total = lineTotalFromQtyAndUnitCost(purchased, unit);
    expect(total.toFixed(2)).toBe('250050.00');
    const remaining = new Prisma.Decimal(30);
    expect(
      lineTotalFromQtyAndUnitCost(remaining, unit).toFixed(2),
    ).not.toBe(total.toFixed(2));
    expect(total.sub(lineTotalFromQtyAndUnitCost(remaining, unit)).toFixed(2)).toBe(
      lineTotalFromQtyAndUnitCost(purchased.sub(remaining), unit).toFixed(2),
    );
  });

  it('purchaseTotalsWithinTolerance acepta diferencias menores al umbral', () => {
    expect(
      purchaseTotalsWithinTolerance(
        new Prisma.Decimal('100.4'),
        new Prisma.Decimal('100'),
        new Prisma.Decimal('1'),
      ),
    ).toBe(true);
    expect(
      purchaseTotalsWithinTolerance(
        new Prisma.Decimal('102'),
        new Prisma.Decimal('100'),
        new Prisma.Decimal('1'),
      ),
    ).toBe(false);
  });
});
