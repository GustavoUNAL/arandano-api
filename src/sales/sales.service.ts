import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SaleSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ReplaceSaleLinesDto } from './dto/replace-sale-lines.dto';
import { SaleLineInputDto } from './dto/sale-line-input.dto';
import { UpdateSaleDto } from './dto/update-sale.dto';

type PaginationParams = {
  page: number;
  limit: number;
  search?: string;
  source?: SaleSource;
  dateFrom?: string;
  dateTo?: string;
};

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async validateProductIds(lines: SaleLineInputDto[]) {
    const pids = [
      ...new Set(lines.map((l) => l.productId).filter(Boolean)),
    ] as string[];
    if (!pids.length) return;
    const found = await this.prisma.product.findMany({
      where: { id: { in: pids }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== pids.length) {
      throw new BadRequestException(
        'Una o más referencias de producto no son válidas',
      );
    }
  }

  private computeTotal(lines: SaleLineInputDto[]): Prisma.Decimal {
    let total = new Prisma.Decimal(0);
    for (const line of lines) {
      total = total.add(
        new Prisma.Decimal(line.quantity).mul(line.unitPrice),
      );
    }
    return total;
  }

  async create(dto: CreateSaleDto) {
    if (!dto.lines.length) {
      throw new BadRequestException('La venta debe tener al menos una línea');
    }
    await this.validateProductIds(dto.lines);
    const total = this.computeTotal(dto.lines);

    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          saleDate: new Date(dto.saleDate),
          total,
          paymentMethod: dto.paymentMethod ?? null,
          source: dto.source ?? SaleSource.MANUAL,
          mesa: dto.mesa ?? null,
          notes: dto.notes ?? null,
          userId: dto.userId ?? null,
        },
      });
      for (const line of dto.lines) {
        await tx.saleLine.create({
          data: {
            saleId: sale.id,
            productId: line.productId ?? null,
            productName: line.productName,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            costAtSale:
              line.costAtSale !== undefined
                ? new Prisma.Decimal(line.costAtSale)
                : null,
            profit:
              line.profit !== undefined
                ? new Prisma.Decimal(line.profit)
                : null,
          },
        });
      }
      return this.findOne(sale.id);
    });
  }

  async findAll(params: PaginationParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const search = params.search?.trim();
    const and: Prisma.SaleWhereInput[] = [];

    if (search?.length) {
      and.push({
        OR: [
          { paymentMethod: { contains: search, mode: 'insensitive' } },
          { mesa: { contains: search, mode: 'insensitive' } },
          { notes: { contains: search, mode: 'insensitive' } },
          {
            lines: {
              some: {
                productName: { contains: search, mode: 'insensitive' },
              },
            },
          },
        ],
      });
    }

    if (params.source) {
      and.push({ source: params.source });
    }

    const saleDate: Prisma.DateTimeFilter = {};
    if (params.dateFrom?.trim()) {
      saleDate.gte = new Date(params.dateFrom.trim());
    }
    if (params.dateTo?.trim()) {
      const end = new Date(params.dateTo.trim());
      end.setHours(23, 59, 59, 999);
      saleDate.lte = end;
    }
    if (Object.keys(saleDate).length > 0) {
      and.push({ saleDate });
    }

    const where: Prisma.SaleWhereInput =
      and.length === 0 ? {} : { AND: and };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        skip,
        take: limit,
        orderBy: { saleDate: 'desc' },
        include: {
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, hasNextPage: skip + data.length < total },
    };
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        lines: {
          orderBy: { id: 'asc' },
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    return sale;
  }

  async update(id: string, dto: UpdateSaleDto) {
    const existing = await this.prisma.sale.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Sale not found');
    }

    await this.prisma.sale.update({
      where: { id },
      data: {
        ...(dto.saleDate !== undefined
          ? { saleDate: new Date(dto.saleDate) }
          : {}),
        ...(dto.paymentMethod !== undefined
          ? { paymentMethod: dto.paymentMethod || null }
          : {}),
        ...(dto.source !== undefined ? { source: dto.source } : {}),
        ...(dto.mesa !== undefined ? { mesa: dto.mesa || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.userId !== undefined ? { userId: dto.userId || null } : {}),
      },
    });

    return this.findOne(id);
  }

  async replaceLines(id: string, dto: ReplaceSaleLinesDto) {
    const existing = await this.prisma.sale.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Sale not found');
    }

    if (!dto.lines.length) {
      throw new BadRequestException('Debe haber al menos una línea');
    }

    await this.validateProductIds(dto.lines);
    const total = this.computeTotal(dto.lines);

    await this.prisma.$transaction(async (tx) => {
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      for (const line of dto.lines) {
        await tx.saleLine.create({
          data: {
            saleId: id,
            productId: line.productId ?? null,
            productName: line.productName,
            quantity: new Prisma.Decimal(line.quantity),
            unitPrice: new Prisma.Decimal(line.unitPrice),
            costAtSale:
              line.costAtSale !== undefined
                ? new Prisma.Decimal(line.costAtSale)
                : null,
            profit:
              line.profit !== undefined
                ? new Prisma.Decimal(line.profit)
                : null,
          },
        });
      }
      await tx.sale.update({
        where: { id },
        data: { total },
      });
    });

    return this.findOne(id);
  }
}
