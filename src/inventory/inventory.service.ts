import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

type PaginationParams = {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
};

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireInventoryCategoryId(id: string) {
    const c = await this.prisma.category.findFirst({
      where: { id, type: CategoryType.INVENTORY },
      select: { id: true },
    });
    if (!c) {
      throw new NotFoundException('Inventory category not found');
    }
    return c.id;
  }

  async create(dto: CreateInventoryDto) {
    const categoryId = await this.requireInventoryCategoryId(dto.categoryId);
    return this.prisma.inventory.create({
      data: {
        name: dto.name,
        categoryId,
        quantity: new Prisma.Decimal(dto.quantity),
        unit: dto.unit,
        unitCost: new Prisma.Decimal(dto.unitCost),
        supplier: dto.supplier ?? null,
        lot: dto.lot ?? null,
        minStock:
          dto.minStock !== undefined
            ? new Prisma.Decimal(dto.minStock)
            : null,
      },
      include: { category: true },
    });
  }

  async findAll(params: PaginationParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryWhereInput = {
      deletedAt: null,
      ...(params.search?.trim().length
        ? { name: { contains: params.search.trim(), mode: 'insensitive' } }
        : {}),
      ...(params.categoryId?.trim().length
        ? { categoryId: params.categoryId.trim() }
        : {}),
    };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.inventory.count({ where }),
      this.prisma.inventory.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: { category: true },
      }),
    ]);

    return {
      data,
      meta: { page, limit, total, hasNextPage: skip + data.length < total },
    };
  }

  async findOne(id: string) {
    const row = await this.prisma.inventory.findFirst({
      where: { id, deletedAt: null },
      include: { category: true },
    });
    if (!row) {
      throw new NotFoundException('Inventory item not found');
    }
    return row;
  }

  async update(id: string, dto: UpdateInventoryDto) {
    const existing = await this.prisma.inventory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Inventory item not found');
    }

    let categoryId: string | undefined;
    if (dto.categoryId !== undefined) {
      categoryId = await this.requireInventoryCategoryId(dto.categoryId);
    }

    return this.prisma.inventory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(dto.quantity !== undefined
          ? { quantity: new Prisma.Decimal(dto.quantity) }
          : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.unitCost !== undefined
          ? { unitCost: new Prisma.Decimal(dto.unitCost) }
          : {}),
        ...(dto.supplier !== undefined ? { supplier: dto.supplier || null } : {}),
        ...(dto.lot !== undefined ? { lot: dto.lot || null } : {}),
        ...(dto.minStock !== undefined
          ? { minStock: new Prisma.Decimal(dto.minStock) }
          : {}),
      },
      include: { category: true },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.inventory.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Inventory item not found');
    }

    return this.prisma.inventory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
