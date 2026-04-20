import { Injectable } from '@nestjs/common';
import { RecipeCostKind } from '@prisma/client';
import { categoryDisplayName } from '../common/category-display-name';
import { PrismaService } from '../prisma/prisma.service';

export type RecipeCostLineDto = {
  id: string;
  recipeId: string;
  productId: string;
  productName: string;
  productActive: boolean;
  productType: string | null;
  categoryId: string | null;
  categoryName: string | null;
  kind: RecipeCostKind;
  name: string;
  quantity: string | null;
  unit: string;
  lineTotalCOP: string;
  sheetUnitCost: string | null;
  sortOrder: number;
};

export type RecipeCostsByProductDto = {
  recipeId: string;
  productId: string;
  productName: string;
  productActive: boolean;
  productType: string | null;
  categoryId: string | null;
  categoryName: string | null;
  fixed: RecipeCostLineDto[];
  variable: RecipeCostLineDto[];
  totals: { fixedCOP: string; variableCOP: string; totalCOP: string };
  /** Filas de tabla listas para render (fixed + variable, ya ordenadas). */
  rows: RecipeCostLineDto[];
};

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Todas las líneas de costo de receta (`costos`), agrupadas por producto y luego por tipo (fijo / variable).
   */
  async listRecipeCosts(): Promise<{
    products: RecipeCostsByProductDto[];
    /** Versión “flat” para tablas (una fila por costo) */
    rows: RecipeCostLineDto[];
    totals: { fixedCOP: string; variableCOP: string; totalCOP: string };
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
                type: true,
                categoryId: true,
                category: { select: { id: true, name: true } },
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
      productType: c.recipe.product.type ?? null,
      categoryId: c.recipe.product.categoryId ?? null,
      categoryName: c.recipe.product.category
        ? categoryDisplayName(c.recipe.product.category.name)
        : null,
      kind: c.kind,
      name: c.name,
      quantity: c.quantity?.toString() ?? null,
      unit: c.unit,
      lineTotalCOP: c.lineTotalCOP.toFixed(0),
      sheetUnitCost: c.sheetUnitCost ?? null,
      sortOrder: c.sortOrder,
    });

    let sumFixed = 0;
    let sumVar = 0;
    const flatRows: RecipeCostLineDto[] = [];

    const byProduct = new Map<
      string,
      {
        recipeId: string;
        productId: string;
        productName: string;
        productActive: boolean;
        productType: string | null;
        categoryId: string | null;
        categoryName: string | null;
        fixed: RecipeCostLineDto[];
        variable: RecipeCostLineDto[];
        sumFixed: number;
        sumVar: number;
      }
    >();

    for (const c of rows) {
      const dto = mapRow(c);
      const v = Number(c.lineTotalCOP);
      flatRows.push(dto);
      const key = dto.productId;
      let grp = byProduct.get(key);
      if (!grp) {
        grp = {
          recipeId: dto.recipeId,
          productId: dto.productId,
          productName: dto.productName,
          productActive: dto.productActive,
          productType: dto.productType,
          categoryId: dto.categoryId,
          categoryName: dto.categoryName,
          fixed: [],
          variable: [],
          sumFixed: 0,
          sumVar: 0,
        };
        byProduct.set(key, grp);
      }
      if (c.kind === RecipeCostKind.FIJO) {
        grp.fixed.push(dto);
        if (Number.isFinite(v)) sumFixed += v;
        if (Number.isFinite(v)) grp.sumFixed += v;
      } else {
        grp.variable.push(dto);
        if (Number.isFinite(v)) sumVar += v;
        if (Number.isFinite(v)) grp.sumVar += v;
      }
    }

    const products: RecipeCostsByProductDto[] = [...byProduct.values()]
      .sort((a, b) => a.productName.localeCompare(b.productName))
      .map((p) => {
        const rows = [...p.fixed, ...p.variable].sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.name.localeCompare(b.name);
        });
        return {
          recipeId: p.recipeId,
          productId: p.productId,
          productName: p.productName,
          productActive: p.productActive,
          productType: p.productType,
          categoryId: p.categoryId,
          categoryName: p.categoryName,
          fixed: p.fixed,
          variable: p.variable,
          rows,
          totals: {
            fixedCOP: p.sumFixed.toFixed(0),
            variableCOP: p.sumVar.toFixed(0),
            totalCOP: (p.sumFixed + p.sumVar).toFixed(0),
          },
        };
      });

    return {
      products,
      rows: flatRows,
      totals: {
        fixedCOP: sumFixed.toFixed(0),
        variableCOP: sumVar.toFixed(0),
        totalCOP: (sumFixed + sumVar).toFixed(0),
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
        categoryName: r.product.category
          ? categoryDisplayName(r.product.category.name)
          : null,
        recipeYield: r.recipeYield.toString(),
        ingredientCount: r.ingredients.length,
        costLineCount: r._count.costs,
        depletedMaterialCount,
        lowStockMaterialCount,
      };
    });
  }
}
