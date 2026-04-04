/**
 * Lee migration-dump.json (export SQLite) y genera prisma/data/organized-dump.json
 * con filas alineadas a los modelos Prisma / columnas PostgreSQL.
 *
 * Uso:
 *   npx tsx scripts/organize-migration-dump.ts
 *   npx tsx scripts/organize-migration-dump.ts --input /ruta/al/migration-dump.json
 *   npx tsx scripts/organize-migration-dump.ts --output prisma/data/custom.json
 *   npx ts-node --transpile-only scripts/organize-migration-dump.ts --split [dir]
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseOptionalDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  if (ISO_DATE.test(value)) return `${value}T12:00:00.000Z`;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseRequiredDateFromDay(value: unknown): string {
  const s = parseOptionalDate(value);
  if (!s) throw new Error(`Fecha inválida: ${String(value)}`);
  return s;
}

function saleDateFromDayAndHour(dateStr: unknown, hour: unknown): string {
  const d =
    typeof dateStr === 'string' && ISO_DATE.test(dateStr)
      ? dateStr
      : parseOptionalDate(dateStr)?.slice(0, 10);
  if (!d) throw new Error(`sale_date inválida: ${String(dateStr)}`);
  const h = typeof hour === 'number' ? hour : Number(hour);
  const hh = Number.isFinite(h) ? Math.min(23, Math.max(0, Math.trunc(h))) : 12;
  return `${d}T${String(hh).padStart(2, '0')}:00:00.000Z`;
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function toFloat(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

type DumpTables = {
  products?: Record<string, unknown>[];
  inventory?: Record<string, unknown>[];
  sales?: Record<string, unknown>[];
  recipes?: Record<string, unknown>[];
  stock_movements?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  expenses?: Record<string, unknown>[];
};

type SourceDump = {
  exportedAt?: string;
  sourceFile?: string;
  tables?: DumpTables;
};

function mapProduct(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    price: toFloat(row.price),
    description: row.description != null ? String(row.description) : '',
    category: String(row.category ?? ''),
    type: String(row.type ?? ''),
    imageUrl: row.imageUrl == null ? null : String(row.imageUrl),
    size: row.size != null ? String(row.size) : '',
    minStock: row.minStock == null ? null : toInt(row.minStock),
    cost: row.cost == null ? null : toFloat(row.cost),
    purchaseDate: parseOptionalDate(row.purchaseDate),
    lot: row.lot == null ? null : String(row.lot),
    supplier: row.supplier == null ? null : String(row.supplier),
    lastSaleDate: parseOptionalDate(row.lastSaleDate),
    totalSold: toInt(row.totalSold, 0),
    createdAt: parseOptionalDate(row.createdAt) ?? new Date().toISOString(),
    updatedAt: parseOptionalDate(row.updatedAt) ?? new Date().toISOString(),
  };
}

function mapInventory(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: String(row.category ?? ''),
    quantity: toFloat(row.quantity),
    initialQuantity: row.initialQuantity == null ? null : toFloat(row.initialQuantity),
    unit: String(row.unit ?? ''),
    capacity: row.capacity == null ? null : toFloat(row.capacity),
    capacityUnit: row.capacityUnit == null ? null : String(row.capacityUnit),
    currentCapacity: row.currentCapacity == null ? null : toFloat(row.currentCapacity),
    currentCapacityUnit:
      row.currentCapacityUnit == null ? null : String(row.currentCapacityUnit),
    unitsPerPackage: row.unitsPerPackage == null ? null : toFloat(row.unitsPerPackage),
    unitsPerPackageUnit:
      row.unitsPerPackageUnit == null ? null : String(row.unitsPerPackageUnit),
    productType: row.productType == null ? null : String(row.productType),
    unitPrice: toFloat(row.unitPrice),
    totalValue: toFloat(row.totalValue),
    code: row.code == null ? null : String(row.code),
    purchaseDate: parseOptionalDate(row.purchaseDate),
    lot: row.lot == null ? null : String(row.lot),
    supplier: row.supplier == null ? null : String(row.supplier),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: parseOptionalDate(row.createdAt),
    updatedAt: parseOptionalDate(row.updatedAt),
    productId: row.productId == null ? null : String(row.productId),
  };
}

function mapSale(row: Record<string, unknown>) {
  const items = row.items;
  if (!Array.isArray(items)) {
    throw new Error(`Venta ${row.id}: items debe ser array`);
  }
  return {
    id: String(row.id),
    saleDate: saleDateFromDayAndHour(row.date, row.hour),
    hour: toInt(row.hour, 0),
    items,
    total: toFloat(row.total),
    paymentMethod: row.paymentMethod == null ? null : String(row.paymentMethod),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: parseOptionalDate(row.createdAt),
    updatedAt: parseOptionalDate(row.updatedAt),
    mesa: row.mesa == null ? null : String(row.mesa),
  };
}

function mapRecipe(row: Record<string, unknown>) {
  const ingredients = row.ingredients;
  if (!Array.isArray(ingredients)) {
    throw new Error(`Receta ${row.id}: ingredients debe ser array`);
  }
  return {
    id: String(row.id),
    productId: String(row.productId ?? ''),
    productName: String(row.productName ?? ''),
    category: String(row.category ?? ''),
    ingredients,
    createdAt: parseOptionalDate(row.createdAt),
    updatedAt: parseOptionalDate(row.updatedAt),
  };
}

function mapStockMovement(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    inventoryItemId: row.inventoryItemId == null ? null : String(row.inventoryItemId),
    productId: row.productId == null ? null : String(row.productId),
    type: String(row.type ?? ''),
    quantity: toFloat(row.quantity),
    unit: String(row.unit ?? ''),
    reason: row.reason == null ? null : String(row.reason),
    notes: row.notes == null ? null : String(row.notes),
    movementDate: parseRequiredDateFromDay(row.date ?? row.movement_date),
    createdAt: parseOptionalDate(row.createdAt),
  };
}

function mapTask(row: Record<string, unknown>) {
  let tags: string | null = null;
  if (row.tags != null) {
    tags =
      typeof row.tags === 'string'
        ? row.tags
        : JSON.stringify(row.tags);
  }
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: row.description == null ? null : String(row.description),
    category: String(row.category ?? ''),
    priority: String(row.priority ?? ''),
    completed: toBool(row.completed),
    createdAt: parseOptionalDate(row.createdAt),
    completedAt: parseOptionalDate(row.completedAt),
    dueDate: parseOptionalDate(row.dueDate),
    assignedTo: row.assignedTo == null ? null : String(row.assignedTo),
    tags,
  };
}

function mapExpense(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    description: String(row.description ?? ''),
    amount: toFloat(row.amount),
    expenseDate: parseRequiredDateFromDay(row.date),
    category: String(row.category ?? ''),
    type: String(row.type ?? ''),
    notes: row.notes == null ? null : String(row.notes),
    createdAt: parseOptionalDate(row.createdAt),
  };
}

function parseArgs() {
  const argv = process.argv.slice(2);
  let input = path.resolve(
    process.cwd(),
    '../ARANDANO/data/migration-dump.json',
  );
  let output = path.resolve(process.cwd(), 'prisma/data/organized-dump.json');
  let split = false;
  let splitDir = path.resolve(process.cwd(), 'prisma/data/tables');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && argv[i + 1]) {
      input = path.resolve(argv[++i]);
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = path.resolve(argv[++i]);
    } else if (argv[i] === '--split') {
      split = true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        splitDir = path.resolve(argv[++i]);
      }
    }
  }
  return { input, output, split, splitDir };
}

function main() {
  const { input, output, split, splitDir } = parseArgs();
  const raw = fs.readFileSync(input, 'utf8');
  const dump = JSON.parse(raw) as SourceDump;
  const tables = dump.tables ?? {};

  const organized = {
    meta: {
      sourceDump: input,
      organizedAt: new Date().toISOString(),
      originalExportedAt: dump.exportedAt ?? null,
      originalSourceFile: dump.sourceFile ?? null,
      counts: {} as Record<string, number>,
    },
    tables: {
      products: (tables.products ?? []).map(mapProduct),
      inventory: (tables.inventory ?? []).map(mapInventory),
      sales: (tables.sales ?? []).map(mapSale),
      recipes: (tables.recipes ?? []).map(mapRecipe),
      stock_movements: (tables.stock_movements ?? []).map(mapStockMovement),
      tasks: (tables.tasks ?? []).map(mapTask),
      expenses: (tables.expenses ?? []).map(mapExpense),
    },
  };

  for (const key of Object.keys(organized.tables)) {
    organized.meta.counts[key] = (organized.tables as Record<string, unknown[]>)[key]
      .length;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(organized, null, 2), 'utf8');
  console.log(
    `Escrito ${output} (${Object.entries(organized.meta.counts)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ')})`,
  );

  if (split) {
    fs.mkdirSync(splitDir, { recursive: true });
    fs.writeFileSync(
      path.join(splitDir, '_meta.json'),
      JSON.stringify(organized.meta, null, 2),
      'utf8',
    );
    for (const [table, rows] of Object.entries(organized.tables)) {
      fs.writeFileSync(
        path.join(splitDir, `${table}.json`),
        JSON.stringify(rows, null, 2),
        'utf8',
      );
    }
    console.log(`Tablas sueltas en ${splitDir}/`);
  }
}

main();
