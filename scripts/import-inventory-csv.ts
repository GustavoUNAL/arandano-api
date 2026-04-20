/**
 * Aplica un CSV exportado con el mismo esquema que `export-inventory-csv.ts`
 * (v1 sin `purchase_lot_supplier`, v2 con esa columna) sobre `inventory` y,
 * si aplica, `purchase_lots` por código de lote + fecha de compra + proveedor.
 *
 * No modifica `stock_movements` (la columna `stock_movements_sum_qty` se ignora).
 *
 *   npx ts-node --transpile-only scripts/import-inventory-csv.ts [ruta.csv]
 *
 * Por defecto: exports/inventory_clean.csv
 *   --dry-run   solo valida y cuenta filas
 */

import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { syncPurchaseLotItemCountFromInventory } from '../src/common/sync-purchase-lot-aggregates';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function optStr(s: string): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

function optDecimal(s: string): Prisma.Decimal | null {
  const t = (s ?? '').trim();
  if (t === '') return null;
  return new Prisma.Decimal(t);
}

function reqDecimal(s: string): Prisma.Decimal {
  const t = (s ?? '').trim();
  if (t === '') throw new Error('decimal vacío');
  return new Prisma.Decimal(t);
}

function optDate(s: string): Date | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function reqDate(s: string): Date {
  const d = optDate(s);
  if (!d) throw new Error(`fecha inválida: ${s}`);
  return d;
}

async function main() {
  const argv = process.argv.slice(2);
  let dryRun = false;
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry-run') dryRun = true;
    else if (!argv[i].startsWith('-')) paths.push(argv[i]);
  }

  const csvPath = path.resolve(
    process.cwd(),
    paths[0] ?? path.join('exports', 'inventory_clean.csv'),
  );

  if (!fs.existsSync(csvPath)) {
    console.error(`No existe el archivo: ${csvPath}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) {
    console.error('CSV sin datos.');
    process.exit(1);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const expectedV1 = [
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
    'stock_movements_sum_qty',
    'created_at',
    'updated_at',
  ];
  const expectedV2 = [
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
  const matches = (exp: string[]) =>
    header.length === exp.length && exp.every((h, i) => header[i] === h);
  let csvFormat: 'v1' | 'v2';
  if (matches(expectedV2)) {
    csvFormat = 'v2';
  } else if (matches(expectedV1)) {
    csvFormat = 'v1';
  } else {
    console.error(
      'Cabecera CSV inesperada. Se esperaba el esquema v1 o v2 (ver export-inventory-csv.ts).\nrecibido:\n',
      header.join(','),
    );
    process.exit(1);
  }

  type Row = {
    id: string;
    name: string;
    categoryId: string;
    quantity: Prisma.Decimal;
    unit: string;
    unitCost: Prisma.Decimal;
    supplier: string | null;
    lot: string | null;
    minStock: Prisma.Decimal | null;
    deletedAt: Date | null;
    purchaseDateRaw: string;
    /** Proveedor explícito del lote en CSV (solo v2); si falta, se usa supplier del ítem al upsertear purchase_lots. */
    purchaseLotSupplier: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  const rows: Row[] = [];
  const colCount = csvFormat === 'v2' ? expectedV2.length : expectedV1.length;
  for (let li = 1; li < lines.length; li++) {
    const cells = parseCsvLine(lines[li]);
    if (cells.length !== colCount) {
      console.error(`Línea ${li + 1}: se esperaban ${colCount} columnas, hay ${cells.length}`);
      process.exit(1);
    }
    try {
      if (csvFormat === 'v2') {
        rows.push({
          id: cells[0].trim(),
          name: cells[1],
          categoryId: cells[2].trim(),
          quantity: reqDecimal(cells[4]),
          unit: cells[5].trim(),
          unitCost: reqDecimal(cells[6]),
          supplier: optStr(cells[7]),
          lot: optStr(cells[8]),
          minStock: optDecimal(cells[9]),
          deletedAt: optDate(cells[10]),
          purchaseDateRaw: cells[11],
          purchaseLotSupplier: optStr(cells[12]),
          createdAt: reqDate(cells[14]),
          updatedAt: reqDate(cells[15]),
        });
      } else {
        rows.push({
          id: cells[0].trim(),
          name: cells[1],
          categoryId: cells[2].trim(),
          quantity: reqDecimal(cells[4]),
          unit: cells[5].trim(),
          unitCost: reqDecimal(cells[6]),
          supplier: optStr(cells[7]),
          lot: optStr(cells[8]),
          minStock: optDecimal(cells[9]),
          deletedAt: optDate(cells[10]),
          purchaseDateRaw: cells[11],
          purchaseLotSupplier: null,
          createdAt: reqDate(cells[13]),
          updatedAt: reqDate(cells[14]),
        });
      }
    } catch (e) {
      console.error(`Línea ${li + 1}:`, e);
      process.exit(1);
    }
  }

  console.log(`Filas a aplicar: ${rows.length}${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun) {
    process.exit(0);
  }

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const BATCH = 40;
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      await prisma.$transaction(async (tx) => {
        for (const r of chunk) {
          const code = r.lot?.trim() ?? '';
          if (code) {
            const purchaseDate =
              optDate(r.purchaseDateRaw) ?? r.createdAt;
            const supplierForLot =
              r.purchaseLotSupplier ?? r.supplier ?? null;
            await tx.purchaseLot.upsert({
              where: { code },
              create: {
                code,
                purchaseDate,
                supplier: supplierForLot,
              },
              update: {
                ...(optDate(r.purchaseDateRaw)
                  ? { purchaseDate: optDate(r.purchaseDateRaw)! }
                  : {}),
                ...(supplierForLot != null ? { supplier: supplierForLot } : {}),
              },
            });
          }

          await tx.inventory.upsert({
            where: { id: r.id },
            create: {
              id: r.id,
              name: r.name,
              categoryId: r.categoryId,
              quantity: r.quantity,
              unit: r.unit,
              unitCost: r.unitCost,
              supplier: r.supplier,
              lot: code || null,
              minStock: r.minStock,
              deletedAt: r.deletedAt,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
            },
            update: {
              name: r.name,
              categoryId: r.categoryId,
              quantity: r.quantity,
              unit: r.unit,
              unitCost: r.unitCost,
              supplier: r.supplier,
              lot: code || null,
              minStock: r.minStock,
              deletedAt: r.deletedAt,
              updatedAt: r.updatedAt,
            },
          });
        }
      });
      console.log(`… ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
    }

    const distinctLots = [
      ...new Set(
        rows
          .map((r) => r.lot?.trim())
          .filter((c): c is string => !!c?.length),
      ),
    ];
    for (const code of distinctLots) {
      await syncPurchaseLotItemCountFromInventory(prisma, code);
    }
    if (distinctLots.length) {
      console.log(
        `item_count sincronizado en purchase_lots para ${distinctLots.length} código(s) de lote.`,
      );
    }

    console.log(`OK: inventario actualizado desde ${csvPath}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
