import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdatePurchaseLotDto } from './dto/update-purchase-lot.dto';

type ListParams = {
  page: number;
  limit: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class PurchaseLotsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: ListParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const and: Prisma.PurchaseLotWhereInput[] = [];
    const search = params.search?.trim();
    if (search?.length) {
      and.push({
        OR: [
          { code: { contains: search, mode: 'insensitive' } },
          { supplier: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    const purchaseDate: Prisma.DateTimeFilter = {};
    if (params.dateFrom?.trim()) {
      purchaseDate.gte = new Date(params.dateFrom.trim());
    }
    if (params.dateTo?.trim()) {
      const end = new Date(params.dateTo.trim());
      end.setHours(23, 59, 59, 999);
      purchaseDate.lte = end;
    }
    if (Object.keys(purchaseDate).length > 0) {
      and.push({ purchaseDate });
    }

    const where: Prisma.PurchaseLotWhereInput =
      and.length === 0 ? {} : { AND: and };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.purchaseLot.count({ where }),
      this.prisma.purchaseLot.findMany({
        where,
        skip,
        take: limit,
        orderBy: { purchaseDate: 'desc' },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, hasNextPage: skip + data.length < total },
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.purchaseLot.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Purchase lot not found');
    }
    return row;
  }

  async update(id: string, dto: UpdatePurchaseLotDto) {
    const existing = await this.prisma.purchaseLot.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Purchase lot not found');
    }

    return this.prisma.purchaseLot.update({
      where: { id },
      data: {
        ...(dto.purchaseDate !== undefined
          ? { purchaseDate: new Date(dto.purchaseDate) }
          : {}),
        ...(dto.supplier !== undefined ? { supplier: dto.supplier || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.totalValue !== undefined
          ? { totalValue: new Prisma.Decimal(dto.totalValue) }
          : {}),
      },
    });
  }
}
