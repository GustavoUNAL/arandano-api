import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CategoryType, Prisma, RecipeCostKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';

type PaginationParams = {
  page: number;
  limit: number;
  search?: string;
  categoryId?: string;
  active?: boolean;
  type?: string;
  sort?: 'name' | 'price_asc' | 'price_desc';
};

type IngredientStockStatus =
  | 'AVAILABLE'
  | 'LOW'
  | 'DEPLETED'
  | 'ARCHIVED';

function normalizeCostName(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase();
}

function isAdminCostLine(name: string): boolean {
  return normalizeCostName(name).startsWith('administracion');
}

function isServiceOrIndirectCostLine(name: string): boolean {
  const n = normalizeCostName(name);
  if (n.includes('indirecto')) return true;
  if (n.startsWith('agua')) return true;
  if (n.startsWith('energia')) return true;
  return false;
}

function ingredientStockStatus(
  quantity: Prisma.Decimal,
  minStock: Prisma.Decimal | null,
  deletedAt: Date | null,
): IngredientStockStatus {
  if (deletedAt) return 'ARCHIVED';
  if (quantity.lte(0)) return 'DEPLETED';
  if (minStock != null && quantity.lte(minStock)) return 'LOW';
  return 'AVAILABLE';
}

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
      ...(params.categoryId?.trim().length
        ? { categoryId: params.categoryId.trim() }
        : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
      ...(params.type?.trim().length ? { type: params.type.trim() } : {}),
    };

    let orderBy: Prisma.ProductOrderByWithRelationInput = { name: 'asc' };
    if (params.sort === 'price_asc') {
      orderBy = { price: 'asc' };
    } else if (params.sort === 'price_desc') {
      orderBy = { price: 'desc' };
    }

    const [total, data] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
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
              include: {
                inventoryItem: { include: { category: true } },
              },
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            },
            costs: { orderBy: { sortOrder: 'asc' } },
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

    const costs = recipe.costs.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      quantity: c.quantity?.toString() ?? null,
      unit: c.unit,
      lineTotalCOP: c.lineTotalCOP.toFixed(0),
      sheetUnitCost: c.sheetUnitCost,
      sortOrder: c.sortOrder,
    }));

    const lotCodes = [
      ...new Set(
        recipe.ingredients
          .map((i) => i.inventoryItem.lot)
          .filter((c): c is string => !!c?.trim()),
      ),
    ];
    const purchaseLotRows =
      lotCodes.length > 0
        ? await this.prisma.purchaseLot.findMany({
            where: { code: { in: lotCodes } },
            select: { id: true, code: true, purchaseDate: true },
          })
        : [];
    const purchaseLotByCode = new Map(
      purchaseLotRows.map((p) => [p.code, p]),
    );

    const ingredients = recipe.ingredients.map((ing) => {
      const inv = ing.inventoryItem;
      const lineTotalCOP = new Prisma.Decimal(ing.quantity).mul(inv.unitCost);
      const { sheetUnitCost, sheetQuantity } = parseRecipeSheetSupplier(
        inv.supplier,
      );
      const lotCode = inv.lot?.trim() || null;
      const pl = lotCode ? purchaseLotByCode.get(lotCode) : undefined;
      const stockStatus = ingredientStockStatus(
        inv.quantity,
        inv.minStock,
        inv.deletedAt,
      );
      return {
        id: ing.id,
        sortOrder: ing.sortOrder,
        inventoryItemId: ing.inventoryItemId,
        ingredient: inv.name,
        quantity: ing.quantity.toString(),
        unit: ing.unit,
        unitCostCOP: inv.unitCost.toString(),
        lineTotalCOP: lineTotalCOP.toFixed(0),
        sheetUnitCost,
        sheetQuantity,
        quantityOnHand: inv.quantity.toString(),
        minStock: inv.minStock?.toString() ?? null,
        inventoryCategoryName: inv.category?.name ?? null,
        lotCode,
        purchaseLot: pl
          ? {
              id: pl.id,
              code: pl.code,
              purchaseDate: pl.purchaseDate.toISOString(),
            }
          : null,
        inventoryArchived: inv.deletedAt != null,
        stockStatus,
      };
    });

    const hasUnavailableIngredient = ingredients.some(
      (i) => i.stockStatus === 'DEPLETED' || i.stockStatus === 'ARCHIVED',
    );
    const productAvailable = product.active && !hasUnavailableIngredient;

    return {
      ...rest,
      available: productAvailable,
      recipe: {
        recipeYield: recipe.recipeYield.toString(),
        costs,
        ingredients,
        available: productAvailable,
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

  async upsertRecipe(productId: string, dto: UpsertRecipeDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const ingredients = dto.ingredients ?? [];
    const costsIn = dto.costs ?? [];

    // Administración (30%) se recalcula siempre en backend.
    const costs = costsIn.filter((c) => !isAdminCostLine(c.name));

    if (!ingredients.length && !costs.length) {
      await this.prisma.recipe.deleteMany({ where: { productId } });
      return this.findOne(productId);
    }

    const invIds =
      ingredients.length > 0
        ? [...new Set(ingredients.map((i) => i.inventoryItemId))]
        : [];
    const invRows =
      invIds.length > 0
        ? await this.prisma.inventory.findMany({
            where: { id: { in: invIds }, deletedAt: null },
            select: { id: true, unitCost: true },
          })
        : [];
    if (invRows.length !== invIds.length) {
      throw new BadRequestException(
        'Uno o más insumos de inventario no existen o están archivados',
      );
    }
    const invCostById = new Map(invRows.map((r) => [r.id, r.unitCost]));

    // Base: (costo insumos de inventario) + (servicios/indirectos)
    let baseTotal = new Prisma.Decimal(0);
    for (const ing of ingredients) {
      const uc = invCostById.get(ing.inventoryItemId);
      if (!uc) continue;
      baseTotal = baseTotal.add(new Prisma.Decimal(ing.quantity).mul(uc));
    }
    for (const c of costs) {
      if (!isServiceOrIndirectCostLine(c.name)) continue;
      baseTotal = baseTotal.add(new Prisma.Decimal(c.lineTotalCOP));
    }
    const adminLineTotal = baseTotal
      .mul(new Prisma.Decimal(0.3))
      .toDecimalPlaces(0);
    const adminCostLine =
      adminLineTotal.gt(0)
        ? {
            kind: 'FIJO' as const,
            name: 'Administración (30%)',
            quantity: undefined,
            unit: 'porción',
            lineTotalCOP: Number(adminLineTotal.toString()),
            sheetUnitCost: undefined,
            sortOrder:
              costs.length > 0
                ? Math.max(...costs.map((x) => x.sortOrder ?? 0)) + 1
                : 0,
          }
        : null;

    const yieldDec = new Prisma.Decimal(dto.recipeYield);

    await this.prisma.$transaction(async (tx) => {
      let recipe = await tx.recipe.findUnique({ where: { productId } });
      if (!recipe) {
        recipe = await tx.recipe.create({
          data: { productId, recipeYield: yieldDec },
        });
      } else {
        await tx.recipe.update({
          where: { id: recipe.id },
          data: { recipeYield: yieldDec },
        });
        await tx.recipeIngredient.deleteMany({
          where: { recipeId: recipe.id },
        });
        await tx.recipeCost.deleteMany({ where: { recipeId: recipe.id } });
      }
      if (ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: ingredients.map((ing, i) => ({
            recipeId: recipe!.id,
            inventoryItemId: ing.inventoryItemId,
            quantity: new Prisma.Decimal(ing.quantity),
            unit: ing.unit,
            sortOrder: ing.sortOrder ?? i,
          })),
        });
      }
      if (costs.length > 0) {
        await tx.recipeCost.createMany({
          data: costs.map((c, i) => ({
            recipeId: recipe!.id,
            kind:
              c.kind === 'VARIABLE'
                ? RecipeCostKind.VARIABLE
                : RecipeCostKind.FIJO,
            name: c.name,
            quantity:
              c.quantity != null && c.quantity > 0
                ? new Prisma.Decimal(c.quantity)
                : null,
            unit: c.unit,
            lineTotalCOP: new Prisma.Decimal(c.lineTotalCOP),
            sheetUnitCost: c.sheetUnitCost?.trim() || null,
            sortOrder: c.sortOrder ?? i,
          })),
        });
      }
      if (adminCostLine) {
        await tx.recipeCost.create({
          data: {
            recipeId: recipe!.id,
            kind: RecipeCostKind.FIJO,
            name: adminCostLine.name,
            quantity: null,
            unit: adminCostLine.unit,
            lineTotalCOP: new Prisma.Decimal(adminCostLine.lineTotalCOP),
            sheetUnitCost: null,
            sortOrder: adminCostLine.sortOrder,
          },
        });
      }
    });

    return this.findOne(productId);
  }
}
