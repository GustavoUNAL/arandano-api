import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CategoryType,
  Prisma,
  PrismaClient,
  SaleSource,
  StockMovementType,
} from '@prisma/client';
import { Pool } from 'pg';

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'prisma/data/organized-dump.json');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) {
      file = path.resolve(argv[++i]);
    }
  }
  return { file };
}

function d(iso: string | null | undefined): Date | undefined {
  if (iso == null || iso === '') return undefined;
  return new Date(iso);
}

function mapPaymentMethod(raw: unknown): string | null {
  if (raw == null) return null;
  return String(raw);
}

function mapExpenseType(raw: unknown): string {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'fixed' || s === 'fijo') return 'fijo';
  return 'variable';
}

function mapMovementType(raw: unknown): StockMovementType | null {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'IN' || s.includes('ENTRADA')) return StockMovementType.IN;
  if (s === 'OUT' || s.includes('SALIDA')) return StockMovementType.OUT;
  if (s === 'ADJUSTMENT' || s.includes('AJUSTE')) return StockMovementType.ADJUSTMENT;
  if (s === 'SALE' || s.includes('VENTA')) return StockMovementType.SALE;
  if (s === 'WASTE' || s.includes('MERMA') || s.includes('DESPERDICIO'))
    return StockMovementType.WASTE;
  return null;
}

function slug(s: string): string {
  return (s || '').trim().toLowerCase() || 'general';
}

function slugOrEmpty(s: string): string {
  return (s || '').trim().toLowerCase();
}

function normalizeExpenseCategoryName(raw: string): string {
  const n = slug(raw);
  if (n === 'other' || n === 'otros') return 'general';
  return n;
}

function allocId(): string {
  return crypto.randomUUID();
}

async function ensureCategory(
  prisma: PrismaClient,
  cache: Map<string, string>,
  rawName: string,
  type: CategoryType,
  emptyFallback: string,
): Promise<string> {
  let logical =
    type === CategoryType.PRODUCT
      ? slugOrEmpty(rawName) === ''
        ? emptyFallback
        : slugOrEmpty(rawName)
      : slug(rawName);
  if (type !== CategoryType.PRODUCT) {
    if (logical === 'other' || logical === 'otros') logical = 'general';
    if (logical === '') logical = 'general';
  }
  const key = `${type}:${logical}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const name = `${type}::${logical}`;
  const row = await prisma.category.upsert({
    where: { name },
    create: { name, type },
    update: {},
    select: { id: true },
  });
  cache.set(key, row.id);
  return row.id;
}

function taskCategoryString(raw: string): string {
  let name = slug(raw);
  if (name === 'other' || name === 'otros') name = 'general';
  if (name === '') name = 'general';
  return name;
}

async function main() {
  const { file } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida');

  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw) as {
    tables: {
      products: Record<string, unknown>[];
      inventory: Record<string, unknown>[];
      sales: Record<string, unknown>[];
      recipes: Record<string, unknown>[];
      stock_movements: Record<string, unknown>[];
      tasks: Record<string, unknown>[];
      expenses: Record<string, unknown>[];
    };
  };

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const catCache = new Map<string, string>();
  const productMap = new Map<string, string>();
  const inventoryMap = new Map<string, string>();

  try {
    const { tables } = data;

    for (const p of tables.products) {
      const row = p as Record<string, unknown>;
      const oldId = String(row.id);
      const id = allocId();
      productMap.set(oldId, id);
      const categoryId = await ensureCategory(
        prisma,
        catCache,
        String(row.category ?? ''),
        CategoryType.PRODUCT,
        'sin-categoria',
      );
      const typeRaw = String(row.type ?? '').trim();
      const productType =
        typeRaw || (String(row.name ?? '').toLowerCase().includes('combo') ? 'combo' : 'bebida');
      await prisma.product.create({
        data: {
          id,
          name: String(row.name ?? ''),
          price: new Prisma.Decimal(Number(row.price ?? 0)),
          description: String(row.description ?? ''),
          imageUrl: row.imageUrl == null ? null : String(row.imageUrl),
          size: row.size == null || String(row.size) === '' ? null : String(row.size),
          categoryId,
          type: productType,
          active: true,
          createdAt: d(row.createdAt as string) ?? new Date(),
          updatedAt: d(row.updatedAt as string) ?? new Date(),
        },
      });
    }
    console.log(`products: ${tables.products.length}`);

    for (const inv of tables.inventory) {
      const row = inv as Record<string, unknown>;
      const oldId = String(row.id);
      const id = allocId();
      inventoryMap.set(oldId, id);
      const categoryId = await ensureCategory(
        prisma,
        catCache,
        String(row.category ?? ''),
        CategoryType.INVENTORY,
        'general',
      );
      const unitCost = Number(
        (row as { cost?: unknown }).cost ?? row.unitPrice ?? row.unitCost ?? 0,
      );
      await prisma.inventory.create({
        data: {
          id,
          name: String(row.name ?? ''),
          categoryId,
          quantity: new Prisma.Decimal(Number(row.quantity ?? 0)),
          unit: String(row.unit ?? ''),
          unitCost: new Prisma.Decimal(unitCost),
          supplier: row.supplier == null ? null : String(row.supplier),
          lot: row.code == null ? null : String(row.code),
          createdAt: d(row.createdAt as string | null),
          updatedAt: d(row.updatedAt as string | null),
        },
      });
    }
    console.log(`inventory: ${tables.inventory.length}`);

    for (const r of tables.recipes) {
      const row = r as Record<string, unknown>;
      const oldProductId = String(row.productId ?? '');
      const newProductId = productMap.get(oldProductId);
      if (!newProductId) continue;

      const ing = row.ingredients;
      if (!Array.isArray(ing) || ing.length === 0) continue;

      const ingredientRows: Array<{
        inventoryItemId: string;
        quantity: Prisma.Decimal;
        unit: string;
      }> = [];
      for (const rawIng of ing) {
        const elem = rawIng as Record<string, unknown>;
        const oldInvId = String(elem.productId ?? '');
        const newInvId = inventoryMap.get(oldInvId);
        if (!newInvId) continue;
        ingredientRows.push({
          inventoryItemId: newInvId,
          quantity: new Prisma.Decimal(Number(elem.quantity ?? 0)),
          unit: String(elem.unit ?? ''),
        });
      }
      if (ingredientRows.length === 0) continue;

      const yieldRaw = row.yield ?? row.yieldQty;
      const recipeYield =
        yieldRaw != null && yieldRaw !== ''
          ? new Prisma.Decimal(Number(yieldRaw))
          : new Prisma.Decimal(1);

      const recipe = await prisma.recipe.create({
        data: {
          id: allocId(),
          productId: newProductId,
          recipeYield,
          createdAt: d(row.createdAt as string) ?? new Date(),
          updatedAt: d(row.updatedAt as string) ?? new Date(),
        },
      });

      for (const ir of ingredientRows) {
        await prisma.recipeIngredient.create({
          data: {
            id: allocId(),
            recipeId: recipe.id,
            inventoryItemId: ir.inventoryItemId,
            quantity: ir.quantity,
            unit: ir.unit,
          },
        });
      }
    }
    console.log(`recipes: ${tables.recipes.length}`);

    for (const s of tables.sales) {
      const row = s as Record<string, unknown>;
      const newSaleId = allocId();
      const items = row.items;
      const lineData: Array<{
        productId: string;
        productName: string;
        quantity: Prisma.Decimal;
        unitPrice: Prisma.Decimal;
      }> = [];
      if (Array.isArray(items)) {
        for (const raw of items) {
          const item = raw as Record<string, unknown>;
          const oldPid = String(item.productId ?? '');
          const newPid = productMap.get(oldPid);
          if (!newPid) continue;
          lineData.push({
            productId: newPid,
            productName: String(item.productName ?? ''),
            quantity: new Prisma.Decimal(Number(item.quantity ?? 0)),
            unitPrice: new Prisma.Decimal(Number(item.price ?? 0)),
          });
        }
      }

      await prisma.sale.create({
        data: {
          id: newSaleId,
          saleDate: d(String(row.saleDate)) ?? new Date(),
          total: new Prisma.Decimal(Number(row.total ?? 0)),
          paymentMethod: mapPaymentMethod(row.paymentMethod),
          notes: row.notes == null ? null : String(row.notes),
          mesa: row.mesa == null ? null : String(row.mesa),
          source: SaleSource.MANUAL,
          createdAt: d(row.createdAt as string | null),
          updatedAt: d(row.updatedAt as string | null),
          lines: {
            create: lineData.map((l) => ({
              id: allocId(),
              productId: l.productId,
              productName: l.productName,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          },
        },
      });
    }
    console.log(`sales: ${tables.sales.length}`);

    for (const sm of tables.stock_movements) {
      const row = sm as Record<string, unknown>;
      const oldInv = row.inventoryItemId == null ? null : String(row.inventoryItemId);
      if (!oldInv) continue;
      const newInv = inventoryMap.get(oldInv);
      if (!newInv) continue;
      const mt = mapMovementType(row.type);
      if (!mt) continue;
      await prisma.stockMovement.create({
        data: {
          id: allocId(),
          inventoryItemId: newInv,
          type: mt,
          quantity: new Prisma.Decimal(Number(row.quantity ?? 0)),
          unit: String(row.unit ?? ''),
          reason: row.reason == null ? null : String(row.reason),
          notes: row.notes == null ? null : String(row.notes),
          movementDate: d(String(row.movementDate)) ?? new Date(),
          createdAt: d(row.createdAt as string | null) ?? new Date(),
        },
      });
    }
    console.log(`stock_movements: ${tables.stock_movements.length}`);

    for (const t of tables.tasks) {
      const row = t as Record<string, unknown>;
      await prisma.task.create({
        data: {
          id: allocId(),
          title: String(row.title ?? ''),
          description: row.description == null ? null : String(row.description),
          category: taskCategoryString(String(row.category ?? '')),
          priority: String(row.priority ?? ''),
          completed: Boolean(row.completed),
          createdAt: d(row.createdAt as string | null) ?? new Date(),
          completedAt: d(row.completedAt as string | null),
          dueDate: d(row.dueDate as string | null),
          assignedToId: null,
          tags: row.tags == null ? null : String(row.tags),
        },
      });
    }
    console.log(`tasks: ${tables.tasks.length}`);

    for (const e of tables.expenses) {
      const row = e as Record<string, unknown>;
      const name = normalizeExpenseCategoryName(String(row.category ?? ''));
      const categoryId = await ensureCategory(
        prisma,
        catCache,
        name,
        CategoryType.EXPENSE,
        'general',
      );
      await prisma.expense.create({
        data: {
          id: allocId(),
          description: String(row.description ?? ''),
          amount: new Prisma.Decimal(Number(row.amount ?? 0)),
          expenseDate: d(String(row.expenseDate)) ?? new Date(),
          categoryId,
          type: mapExpenseType(row.type),
          notes: row.notes == null ? null : String(row.notes),
          createdAt: d(row.createdAt as string | null) ?? new Date(),
        },
      });
    }
    console.log(`expenses: ${tables.expenses.length}`);
    console.log('Importación completada.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
