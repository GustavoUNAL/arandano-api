import { Injectable, NotFoundException } from '@nestjs/common';
import { CategoryType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

type PaginationParams = {
  page: number;
  limit: number;
  search?: string;
};

/** Parsea `Inventory.supplier` generado por los scripts `seed-*-recipes.ts`. */
function parseRecipeSheetSupplier(s: string | null | undefined): {
  sheetUnitCost: string | null;
  sheetQuantity: string | null;
} {
  if (!s?.trim()) {
    return { sheetUnitCost: null, sheetQuantity: null };
  }
  const sep = ' | Cantidad (hoja): ';
  const i = s.indexOf(sep);
  if (i === -1) {
    return { sheetUnitCost: s.trim(), sheetQuantity: null };
  }
  const head = s.slice(0, i).replace(/^Costo unitario \(hoja\):\s*/i, '').trim();
  const qty = s.slice(i + sep.length).trim();
  return { sheetUnitCost: head || null, sheetQuantity: qty || null };
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private async requireProductCategoryId(id: string) {
    const c = await this.prisma.category.findFirst({
      where: { id, type: CategoryType.PRODUCT },
      select: { id: true },
    });
    if (!c) {
      throw new NotFoundException('Product category not found');
    }
    return c.id;
  }

  async create(dto: CreateProductDto) {
    const categoryId = await this.requireProductCategoryId(dto.categoryId);
    return this.prisma.product.create({
      data: {
        name: dto.name,
        price: new Prisma.Decimal(dto.price),
        categoryId,
        type: dto.type,
        description: dto.description ?? '',
        size: dto.size ?? null,
        imageUrl: dto.imageUrl ?? null,
        active: dto.active ?? true,
      },
      include: { category: true },
    });
  }

  async findAll(params: PaginationParams) {
    const page = Math.max(1, Math.trunc(params.page));
    const limit = Math.min(100, Math.max(1, Math.trunc(params.limit)));
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(params.search?.trim().length
        ? { name: { contains: params.search.trim(), mode: 'insensitive' } }
        : {}),
    };

    const [total, data] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
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
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: true,
        recipe: {
          include: {
            ingredients: {
              include: { inventoryItem: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const { recipe, ...rest } = product;
    if (!recipe) {
      return rest;
    }

    const lines = recipe.ingredients.map((ing) => {
      const inv = ing.inventoryItem;
      const lineTotalCOP = new Prisma.Decimal(ing.quantity).mul(inv.unitCost);
      const { sheetUnitCost, sheetQuantity } = parseRecipeSheetSupplier(
        inv.supplier,
      );
      return {
        ingredient: inv.name,
        quantity: ing.quantity.toString(),
        unit: ing.unit,
        unitCostCOP: inv.unitCost.toString(),
        lineTotalCOP: lineTotalCOP.toFixed(0),
        sheetUnitCost,
        sheetQuantity,
      };
    });

    return {
      ...rest,
      recipe: {
        recipeYield: recipe.recipeYield.toString(),
        lines,
      },
    };
  }

  async update(id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    let categoryId: string | undefined;
    if (dto.categoryId !== undefined) {
      categoryId = await this.requireProductCategoryId(dto.categoryId);
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.price !== undefined ? { price: new Prisma.Decimal(dto.price) } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.size !== undefined ? { size: dto.size || null } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl ?? null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: { category: true },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
