import { Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { mapCategoryRelation } from '../common/category-display-name';
import { PrismaService } from '../prisma/prisma.service';

type ListParams = {
  page: number;
  limit: number;
  inventoryItemId?: string;
  saleId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: ListParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(200, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {};
    if (params.inventoryItemId?.trim()) {
      where.inventoryItemId = params.inventoryItemId.trim();
    }
    if (params.saleId?.trim()) {
      where.saleId = params.saleId.trim();
    }
    const typeRaw = params.type?.trim();
    if (
      typeRaw &&
      (Object.values(StockMovementType) as string[]).includes(typeRaw)
    ) {
      where.type = typeRaw as StockMovementType;
    }

    const movementDate: Prisma.DateTimeFilter = {};
    if (params.dateFrom?.trim()) {
      movementDate.gte = new Date(params.dateFrom.trim());
    }
    if (params.dateTo?.trim()) {
      const end = new Date(params.dateTo.trim());
      end.setHours(23, 59, 59, 999);
      movementDate.lte = end;
    }
    if (Object.keys(movementDate).length > 0) {
      where.movementDate = movementDate;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { movementDate: 'desc' },
        include: {
          inventoryItem: {
            select: {
              id: true,
              name: true,
              unit: true,
              lot: true,
              category: { select: { id: true, name: true } },
              purchaseLot: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  purchaseDate: true,
                  supplier: true,
                },
              },
            },
          },
          sale: {
            select: {
              id: true,
              saleDate: true,
              total: true,
              paymentMethod: true,
              source: true,
            },
          },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      type: r.type,
      quantity: r.quantity.toString(),
      unit: r.unit,
      reason: r.reason,
      notes: r.notes,
      movementDate: r.movementDate.toISOString(),
      createdAt: r.createdAt.toISOString(),
      inventoryItemId: r.inventoryItemId,
      saleId: r.saleId,
      userId: r.userId,
      inventoryItem: {
        ...r.inventoryItem,
        category: mapCategoryRelation(r.inventoryItem.category),
      },
      sale: r.sale
        ? {
            id: r.sale.id,
            saleDate: r.sale.saleDate.toISOString(),
            total: r.sale.total.toString(),
            paymentMethod: r.sale.paymentMethod,
            source: r.sale.source,
          }
        : null,
      user: r.user,
    }));

    return {
      data,
      meta: {
        page,
        limit,
        total,
        hasNextPage: skip + data.length < total,
      },
    };
  }
}
