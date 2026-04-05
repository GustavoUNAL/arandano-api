import { Injectable } from '@nestjs/common';
import { RecipeCostKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type RecipeCostLineDto = {
  id: string;
  recipeId: string;
  productId: string;
  productName: string;
  productActive: boolean;
  categoryName: string | null;
  kind: RecipeCostKind;
  name: string;
  quantity: string | null;
  unit: string;
  lineTotalCOP: string;
  sheetUnitCost: string | null;
  sortOrder: number;
};

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todas las líneas de costo de receta (`costos`), agrupadas por tipo fijo / variable.
   */
  async listRecipeCosts(): Promise<{
    fixed: RecipeCostLineDto[];
    variable: RecipeCostLineDto[];
    totals: { fixedCOP: string; variableCOP: string };
  }> {
    const rows = await this.prisma.recipeCost.findMany({
      where: {
        recipe: {
          product: { deletedAt: null },
        },
      },
      include: {
        recipe: {
          select: {
            id: true,
            productId: true,
            product: {
              select: {
                name: true,
                active: true,
                category: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { recipe: { product: { name: 'asc' } } },
        { kind: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    });

    const mapRow = (c: (typeof rows)[number]): RecipeCostLineDto => ({
      id: c.id,
      recipeId: c.recipeId,
      productId: c.recipe.productId,
      productName: c.recipe.product.name,
      productActive: c.recipe.product.active,
      categoryName: c.recipe.product.category?.name ?? null,
      kind: c.kind,
      name: c.name,
      quantity: c.quantity?.toString() ?? null,
      unit: c.unit,
      lineTotalCOP: c.lineTotalCOP.toFixed(0),
      sheetUnitCost: c.sheetUnitCost ?? null,
      sortOrder: c.sortOrder,
    });

    const fixed: RecipeCostLineDto[] = [];
    const variable: RecipeCostLineDto[] = [];
    let sumFixed = 0;
    let sumVar = 0;

    for (const c of rows) {
      const dto = mapRow(c);
      const v = Number(c.lineTotalCOP);
      if (c.kind === RecipeCostKind.FIJO) {
        fixed.push(dto);
        if (Number.isFinite(v)) sumFixed += v;
      } else {
        variable.push(dto);
        if (Number.isFinite(v)) sumVar += v;
      }
    }

    return {
      fixed,
      variable,
      totals: {
        fixedCOP: sumFixed.toFixed(0),
        variableCOP: sumVar.toFixed(0),
      },
    };
  }

  /** Listado para el panel: producto + rendimiento + # insumos. */
  async listCatalog(categoryId?: string) {
    const rows = await this.prisma.recipe.findMany({
      where: {
        product: {
          deletedAt: null,
          ...(categoryId?.trim().length
            ? { categoryId: categoryId.trim() }
            : {}),
        },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            type: true,
            categoryId: true,
            active: true,
            category: { select: { name: true } },
          },
        },
        ingredients: {
          select: {
            inventoryItem: {
              select: {
                quantity: true,
                minStock: true,
                deletedAt: true,
              },
            },
          },
        },
        _count: { select: { costs: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    return rows.map((r) => {
      let depletedMaterialCount = 0;
      let lowStockMaterialCount = 0;
      for (const row of r.ingredients) {
        const inv = row.inventoryItem;
        if (inv.deletedAt) continue;
        if (inv.quantity.lte(0)) depletedMaterialCount += 1;
        else if (
          inv.minStock != null &&
          inv.quantity.lte(inv.minStock)
        ) {
          lowStockMaterialCount += 1;
        }
      }
      return {
        productId: r.productId,
        productName: r.product.name,
        productActive: r.product.active,
        productType: r.product.type,
        categoryId: r.product.categoryId,
        categoryName: r.product.category?.name ?? null,
        recipeYield: r.recipeYield.toString(),
        ingredientCount: r.ingredients.length,
        costLineCount: r._count.costs,
        depletedMaterialCount,
        lowStockMaterialCount,
      };
    });
  }
}
