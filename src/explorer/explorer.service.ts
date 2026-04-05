import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const TABLE_SLUGS = [
  'users',
  'categories',
  'products',
  'inventory',
  'purchase_lots',
  'recipes',
  'recipe_ingredients',
  'costos',
  'carts',
  'cart_items',
  'sales',
  'sale_lines',
  'payments',
  'stock_movements',
  'expenses',
  'partners',
  'partner_contributions',
  'tasks',
] as const;

export type ExplorerTableSlug = (typeof TABLE_SLUGS)[number];

const SLUG_TO_DELEGATE: Record<
  ExplorerTableSlug,
  keyof PrismaService & string
> = {
  users: 'user',
  categories: 'category',
  products: 'product',
  inventory: 'inventory',
  purchase_lots: 'purchaseLot',
  recipes: 'recipe',
  recipe_ingredients: 'recipeIngredient',
  costos: 'recipeCost',
  carts: 'cart',
  cart_items: 'cartItem',
  sales: 'sale',
  sale_lines: 'saleLine',
  payments: 'payment',
  stock_movements: 'stockMovement',
  expenses: 'expense',
  partners: 'partner',
  partner_contributions: 'partnerContribution',
  tasks: 'task',
};

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        jsonSafe(v),
      ]),
    );
  }
  return value;
}

@Injectable()
export class ExplorerService {
  constructor(private readonly prisma: PrismaService) {}

  listTables() {
    return TABLE_SLUGS.map((slug) => ({
      slug,
      sqlName: slug,
    }));
  }

  private getDelegate(slug: string) {
    if (!TABLE_SLUGS.includes(slug as ExplorerTableSlug)) {
      throw new NotFoundException(`Unknown table: ${slug}`);
    }
    const key = SLUG_TO_DELEGATE[slug as ExplorerTableSlug];
    const delegate = (this.prisma as unknown as Record<string, unknown>)[key];
    if (
      !delegate ||
      typeof (delegate as { count?: unknown }).count !== 'function'
    ) {
      throw new NotFoundException(`No delegate for: ${slug}`);
    }
    return delegate as {
      count: (args?: object) => Promise<number>;
      findMany: (args: object) => Promise<Record<string, unknown>[]>;
    };
  }

  async getTableRows(
    slug: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; rows: unknown[]; columns: string[] }> {
    const delegate = this.getDelegate(slug);
    const take = Math.min(Math.max(limit, 1), 500);
    const skip = Math.max(offset, 0);

    const [total, rows] = await Promise.all([
      delegate.count(),
      delegate.findMany({
        take,
        skip,
        orderBy: { id: 'asc' },
      }),
    ]);

    const columns =
      rows.length > 0 ? Object.keys(rows[0] as object).sort() : [];

    return {
      total,
      columns,
      rows: rows.map((r) => jsonSafe(r) as unknown),
    };
  }
}
