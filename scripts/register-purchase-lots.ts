import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Registra lotes de compra históricos en `purchase_lots`, agrupando por el mismo
 * código que `inventory.lot` (factura / visita a proveedor).
 *
 * Fuentes:
 * - `json` (default): `prisma/data/tables/inventory.json`
 * - `tsv`: columnas lot, purchaseDate, supplier, item_name, item_id, code, quantity, unit, unitPrice, totalValue, notes
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/register-purchase-lots.ts
 *   npx ts-node --transpile-only scripts/register-purchase-lots.ts --source tsv --file prisma/data/inventory-purchase-lots.tsv
 *   npx ts-node --transpile-only scripts/register-purchase-lots.ts --dry-run
 *   npx ts-node --transpile-only scripts/register-purchase-lots.ts --export-tsv prisma/data/inventory-purchase-lots.tsv
 */

type LotAgg = {
  code: string;
  dates: Date[];
  suppliers: (string | null)[];
  totalValue: number;
  itemCount: number;
  noteSamples: string[];
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'prisma/data/tables/inventory.json');
  let source: 'json' | 'tsv' = 'json';
  let dryRun = false;
  let exportTsv: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) file = path.resolve(argv[++i]);
    else if (argv[i] === '--source' && argv[i + 1])
      source = argv[++i] === 'tsv' ? 'tsv' : 'json';
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--export-tsv' && argv[i + 1])
      exportTsv = path.resolve(argv[++i]);
  }
  return { file, source, dryRun, exportTsv };
}

function parsePurchaseDate(raw: string | undefined | null): Date {
  const s = (raw ?? '').trim();
  if (!s) return new Date();
  const d = new Date(s.length <= 10 ? `${s}T12:00:00.000Z` : s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

type InvJsonRow = {
  id: string;
  name?: string;
  lot?: string | null;
  supplier?: string | null;
  purchaseDate?: string;
  totalValue?: number;
  notes?: string | null;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  code?: string | null;
};

function escapeTsvField(s: string): string {
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function exportInventoryJsonToTsv(outPath: string, rows: InvJsonRow[]) {
  const header = [
    'lot',
    'purchaseDate',
    'supplier',
    'item_name',
    'item_id',
    'code',
    'quantity',
    'unit',
    'unitPrice',
    'totalValue',
    'notes',
  ];
  const lines = [header.join('\t')];
  for (const row of rows) {
    const pd = row.purchaseDate
      ? String(row.purchaseDate).slice(0, 10)
      : '';
    lines.push(
      [
        escapeTsvField(String(row.lot ?? '')),
        pd,
        escapeTsvField(String(row.supplier ?? '')),
        escapeTsvField(String(row.name ?? '')),
        escapeTsvField(String(row.id ?? '')),
        escapeTsvField(String(row.code ?? '')),
        String(row.quantity ?? ''),
        escapeTsvField(String(row.unit ?? '')),
        String(row.unitPrice ?? ''),
        String(row.totalValue ?? ''),
        escapeTsvField(String(row.notes ?? '')),
      ].join('\t'),
    );
  }
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`TSV exportado: ${outPath} (${rows.length} líneas)`);
}

function parseTsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const r: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      r[header[j]] = cols[j] ?? '';
    }
    rows.push(r);
  }
  return rows;
}

function bumpAgg(
  map: Map<string, LotAgg>,
  code: string,
  purchaseDate: Date,
  supplier: string | null,
  totalValue: number,
  note: string | null,
) {
  const c = code.trim();
  if (!c) return;
  let a = map.get(c);
  if (!a) {
    a = {
      code: c,
      dates: [],
      suppliers: [],
      totalValue: 0,
      itemCount: 0,
      noteSamples: [],
    };
    map.set(c, a);
  }
  a.dates.push(purchaseDate);
  a.suppliers.push(supplier);
  a.totalValue += totalValue;
  a.itemCount += 1;
  const n = (note ?? '').trim();
  if (n && a.noteSamples.length < 3) a.noteSamples.push(n);
}

function aggregateFromJson(rows: InvJsonRow[]): Map<string, LotAgg> {
  const map = new Map<string, LotAgg>();
  for (const row of rows) {
    const code = String(row.lot ?? '').trim();
    if (!code) continue;
    bumpAgg(
      map,
      code,
      parsePurchaseDate(row.purchaseDate),
      row.supplier == null || String(row.supplier) === ''
        ? null
        : String(row.supplier),
      Number(row.totalValue ?? 0),
      row.notes == null ? null : String(row.notes),
    );
  }
  return map;
}

function aggregateFromTsv(rows: Record<string, string>[]): Map<string, LotAgg> {
  const map = new Map<string, LotAgg>();
  for (const r of rows) {
    const code = (r.lot ?? r.Lot ?? '').trim();
    if (!code) continue;
    bumpAgg(
      map,
      code,
      parsePurchaseDate(r.purchaseDate ?? r.purchasedate),
      (r.supplier ?? '').trim() || null,
      Number(r.totalValue ?? r.totalvalue ?? 0),
      (r.notes ?? '').trim() || null,
    );
  }
  return map;
}

function pickLotMeta(agg: LotAgg): {
  purchaseDate: Date;
  supplier: string | null;
  notes: string | null;
} {
  const purchaseDate = new Date(
    Math.min(...agg.dates.map((d) => d.getTime())),
  );
  const supplier =
    agg.suppliers.find((s) => s != null && String(s).trim() !== '') ?? null;
  const notes =
    agg.noteSamples.length > 0 ? agg.noteSamples.join(' | ').slice(0, 2000) : null;

  const dateStrs = new Set(agg.dates.map((d) => d.toISOString().slice(0, 10)));
  if (dateStrs.size > 1) {
    console.warn(
      `[lote ${agg.code}] varias fechas de compra en líneas: ${[...dateStrs].join(', ')} — se usa la más antigua`,
    );
  }
  const sups = new Set(
    agg.suppliers.filter((s) => s != null && String(s).trim() !== '') as string[],
  );
  if (sups.size > 1) {
    console.warn(
      `[lote ${agg.code}] varios proveedores: ${[...sups].join(' | ')} — se usa el primero no vacío`,
    );
  }

  return { purchaseDate, supplier, notes };
}

async function main() {
  const { file, source, dryRun, exportTsv } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url && !dryRun && !exportTsv)
    throw new Error('DATABASE_URL no está definida (o use --dry-run / --export-tsv)');

  let invRows: InvJsonRow[] = [];
  if (source === 'json') {
    const raw = fs.readFileSync(file, 'utf8');
    invRows = JSON.parse(raw) as InvJsonRow[];
    if (!Array.isArray(invRows)) throw new Error('JSON: se esperaba un array');
  }

  if (exportTsv) {
    if (source !== 'json') {
      throw new Error('--export-tsv solo con --source json (inventario completo)');
    }
    exportInventoryJsonToTsv(exportTsv, invRows);
    return;
  }

  let aggs: Map<string, LotAgg>;
  if (source === 'json') {
    aggs = aggregateFromJson(invRows);
  } else {
    const raw = fs.readFileSync(file, 'utf8');
    aggs = aggregateFromTsv(parseTsv(raw));
  }

  console.log(`Lotes distintos: ${aggs.size}`);

  if (dryRun) {
    for (const agg of [...aggs.values()].sort((a, b) =>
      a.code.localeCompare(b.code),
    )) {
      const m = pickLotMeta(agg);
      console.log(
        `  ${agg.code} | ${m.purchaseDate.toISOString().slice(0, 10)} | ${m.supplier ?? '—'} | ${agg.itemCount} ítems | $${agg.totalValue.toFixed(0)}`,
      );
    }
    return;
  }

  const pool = new Pool({ connectionString: url! });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    let n = 0;
    for (const agg of aggs.values()) {
      const { purchaseDate, supplier, notes } = pickLotMeta(agg);
      await prisma.purchaseLot.upsert({
        where: { code: agg.code },
        create: {
          code: agg.code,
          purchaseDate,
          supplier,
          notes,
          itemCount: agg.itemCount,
          totalValue: new Prisma.Decimal(agg.totalValue),
        },
        update: {
          purchaseDate,
          supplier,
          notes,
          itemCount: agg.itemCount,
          totalValue: new Prisma.Decimal(agg.totalValue),
        },
      });
      n++;
    }
    console.log(`purchase_lots upsert: ${n}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
