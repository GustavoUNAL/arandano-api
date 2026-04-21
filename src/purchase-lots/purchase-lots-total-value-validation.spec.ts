import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseLotsService } from './purchase-lots.service';

describe('PurchaseLotsService — validación totalValue vs comprobante', () => {
  it('rechaza PATCH de totalValue que no coincide con la suma de líneas (costo histórico)', async () => {
    const prisma = {
      purchaseLot: {
        findUnique: jest.fn().mockResolvedValue({ id: 'lot1', code: 'L-1' }),
        update: jest.fn(),
      },
      purchaseLotLine: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { lineTotalCOP: new Prisma.Decimal('500.00') },
        }),
      },
    };
    const service = new PurchaseLotsService(prisma as any);
    await expect(
      service.update('lot1', { totalValue: 100 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.purchaseLot.update).not.toHaveBeenCalled();
  });
});
