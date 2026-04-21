import { isMissingPurchaseLotLinesTableError } from './prisma-purchase-lot-line-table';

describe('isMissingPurchaseLotLinesTableError', () => {
  it('detecta P2021 de PurchaseLotLine', () => {
    expect(
      isMissingPurchaseLotLinesTableError({
        code: 'P2021',
        meta: { modelName: 'PurchaseLotLine' },
      }),
    ).toBe(true);
  });

  it('ignora otros errores', () => {
    expect(
      isMissingPurchaseLotLinesTableError({
        code: 'P2021',
        meta: { modelName: 'Other' },
      }),
    ).toBe(false);
    expect(isMissingPurchaseLotLinesTableError(new Error('x'))).toBe(false);
  });
});
