/**
 * Exporta toda la tabla inventory + categoría, fecha de compra (purchase_lots) y Σ movimientos.
 *
 *   npx ts-node --transpile-only scripts/export-inventory-csv.ts [ruta-salida.csv]
 *
 * Por defecto: exports/inventory.csv
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { categoryDisplayName } from '../src/common/category-display-name';

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s =
    v instanceof Date ? v.toISOString() : typeof v === 'object' && v !== null && 'toString' in v
      ? (v as { toString: () => string }).toString()
      : String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const outArg = process.argv[2];
  const outPath = path.resolve(
    process.cwd(),
    outArg ?? path.join('exports', 'inventory.csv'),
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const rows = await prisma.inventory.findMany({
      orderBy: { id: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
      },
    });

    const lotCodes = [
      ...new Set(
        rows
          .map((r) => r.lot?.trim())
          .filter((c): c is string => !!c?.length),
      ),
    ];

    type PurchaseLotRow = {
      code: string;
      purchaseDate: Date;
      supplier: string | null;
    };
    const [purchaseRows, movementAgg] = await Promise.all([
      lotCodes.length
        ? prisma.purchaseLot.findMany({
            where: { code: { in: lotCodes } },
            select: { code: true, purchaseDate: true, supplier: true },
          })
        : ([] as PurchaseLotRow[]),
      prisma.stockMovement.groupBy({
        by: ['inventoryItemId'],
        _sum: { quantity: true },
      }),
    ]);

    const purchaseByCode = new Map<string, PurchaseLotRow>(
      purchaseRows.map((p) => [p.code, p]),
    );
    const sumById = new Map<string, Prisma.Decimal>();
    for (const m of movementAgg) {
      sumById.set(
        m.inventoryItemId,
        m._sum.quantity ?? new Prisma.Decimal(0),
      );
    }

    const headers = [
      'id',
      'name',
      'category_id',
      'category_name',
      'quantity',
      'unit',
      'unit_cost',
      'supplier',
      'lot',
      'min_stock',
      'deleted_at',
      'purchase_date',
      'purchase_lot_supplier',
      'stock_movements_sum_qty',
      'created_at',
      'updated_at',
    ];

    const lines: string[] = [csvRow(headers)];

    for (const r of rows) {
      const code = r.lot?.trim() ?? '';
      const pl = code ? purchaseByCode.get(code) : undefined;
      const purchaseDate = pl?.purchaseDate ?? null;
      const invSupplier = r.supplier != null ? String(r.supplier).trim() : '';
      const lotSupplier = pl?.supplier?.trim() || invSupplier || '';
      const movSum = sumById.get(r.id) ?? new Prisma.Decimal(0);

      lines.push(
        csvRow([
          r.id,
          r.name,
          r.categoryId,
          categoryDisplayName(r.category.name),
          r.quantity,
          r.unit,
          r.unitCost,
          r.supplier ?? '',
          r.lot ?? '',
          r.minStock ?? '',
          r.deletedAt ?? '',
          purchaseDate,
          lotSupplier,
          movSum.toString(),
          r.createdAt,
          r.updatedAt,
        ]),
      );
    }

    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`OK: ${lines.length - 1} filas -> ${outPath}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
