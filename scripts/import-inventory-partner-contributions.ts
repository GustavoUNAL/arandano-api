import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CategoryType,
  PartnerContributionType,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { Pool } from 'pg';

/**
 * Importa ítems de inventario desde `prisma/data/tables/inventory.json` y crea
 * un aporte por socio (`PartnerContribution` INSUMO) por cada línea.
 *
 * El socio se infiere de proveedor + notas (p. ej. "Pagado por Sonia", "Lo pagó gustavo",
 * proveedor Patty, proveedor irina, factura Dollarcity con Sonia Herrera).
 * Por defecto: "Negocio (caja)".
 *
 * Idempotencia: borra aportes cuya nota empieza por `import:inv-partner:v1:` y los vuelve a crear.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/import-inventory-partner-contributions.ts
 *   npx ts-node --transpile-only scripts/import-inventory-partner-contributions.ts --file prisma/data/tables/inventory.json
 *   npx ts-node --transpile-only scripts/import-inventory-partner-contributions.ts --dry-run
 *   npx ts-node --transpile-only scripts/import-inventory-partner-contributions.ts --skip-delete-contributions
 */

const CONTRIBUTION_NOTE_PREFIX = 'import:inv-partner:v1:';

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'prisma/data/tables/inventory.json');
  let dryRun = false;
  let skipDeleteContributions = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) file = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') dryRun = true;
    else if (argv[i] === '--skip-delete-contributions') skipDeleteContributions = true;
  }
  return { file, dryRun, skipDeleteContributions };
}

function d(iso: string | null | undefined): Date {
  if (iso == null || iso === '') return new Date();
  const x = new Date(iso);
  return Number.isNaN(x.getTime()) ? new Date() : x;
}

function slug(s: string): string {
  return (s || '').trim().toLowerCase() || 'general';
}

async function ensureCategory(
  prisma: PrismaClient,
  cache: Map<string, string>,
  rawName: string,
): Promise<string> {
  let logical = slug(rawName);
  if (logical === 'other' || logical === 'otros') logical = 'general';
  if (logical === '') logical = 'general';
  const key = `${CategoryType.INVENTORY}:${logical}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const name = `${CategoryType.INVENTORY}::${logical}`;
  const row = await prisma.category.upsert({
    where: { name },
    create: { name, type: CategoryType.INVENTORY },
    update: {},
    select: { id: true },
  });
  cache.set(key, row.id);
  return row.id;
}

/**
 * Orden: primero quién pagó (notas), luego proveedor / lote (p. ej. lot "irina"), luego caja.
 */
function inferPartnerName(
  supplier: string,
  notes: string,
  lot: string | null | undefined,
): string {
  const s = (supplier || '').trim();
  const n = (notes || '').trim();
  const l = (lot || '').trim();
  const hay = `${s}\n${n}\n${l}`;
  const lower = hay.toLowerCase();
  const norm = lower.normalize('NFD').replace(/\p{M}/gu, '');

  if (/gustavo|arteaga/.test(norm)) return 'Gustavo Arteaga';
  if (
    /pagad[oa]\s+por\s+gustavo|lo\s+pag[oó]\s+gustavo|pag[oó]\s+gustavo/i.test(
      hay,
    )
  ) {
    return 'Gustavo Arteaga';
  }
  if (/aporte.*gustavo|gustavo.*aporte/i.test(hay)) return 'Gustavo Arteaga';

  // No usar /sonia/ suelto: los lotes "STOKSONIA-..." contienen esa subcadena.
  if (
    /\bsonia\b/i.test(lower) ||
    /59833986/.test(lower) ||
    /herrera\s*\(\s*59833/i.test(lower)
  ) {
    return 'Sonia Herrera';
  }
  if (/pagad[oa]\s+por\s+sonia/i.test(hay)) return 'Sonia Herrera';

  if (
    s.toLowerCase() === 'irina' ||
    l.toLowerCase() === 'irina' ||
    /\birina\b/.test(lower)
  ) {
    return 'Irina';
  }

  // "Patty" (proveedor) no coincide con el regex /paty/ (falta la segunda t).
  if (/\bpatty\b/i.test(lower) || /\bpaty\b/i.test(lower)) return 'Patty';

  return 'Negocio (caja)';
}

function contributionNoteForRow(inventoryId: string): string {
  return `${CONTRIBUTION_NOTE_PREFIX}${inventoryId}`;
}

async function ensurePartner(
  prisma: PrismaClient,
  cache: Map<string, string>,
  name: string,
  dryRun: boolean,
): Promise<string | null> {
  if (dryRun) return `dry-${name}`;
  const hit = cache.get(name);
  if (hit) return hit;
  const existing = await prisma.partner.findFirst({
    where: { name },
    select: { id: true },
  });
  if (existing) {
    cache.set(name, existing.id);
    return existing.id;
  }
  const p = await prisma.partner.create({ data: { name } });
  cache.set(name, p.id);
  return p.id;
}

type InvRow = {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  unitPrice?: number;
  totalValue?: number;
  code?: string | null;
  purchaseDate?: string;
  lot?: string | null;
  supplier?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

async function main() {
  const { file, dryRun, skipDeleteContributions } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url && !dryRun) throw new Error('DATABASE_URL no está definida (o use --dry-run)');

  const raw = fs.readFileSync(file, 'utf8');
  const rows = JSON.parse(raw) as InvRow[];
  if (!Array.isArray(rows)) throw new Error('Se esperaba un array JSON de inventario');

  const pool = url ? new Pool({ connectionString: url }) : null;
  const prisma = pool
    ? new PrismaClient({ adapter: new PrismaPg(pool) })
    : null;

  const catCache = new Map<string, string>();
  const partnerCache = new Map<string, string>();
  const partnerCounts = new Map<string, number>();

  try {
    if (dryRun || !prisma) {
      console.log('[dry-run] No se escribe en la base de datos.');
    } else if (!skipDeleteContributions) {
      const del = await prisma.partnerContribution.deleteMany({
        where: { notes: { startsWith: CONTRIBUTION_NOTE_PREFIX } },
      });
      console.log(`Aportes import previos eliminados: ${del.count}`);
    }

    let invUpserted = 0;
    let contribCreated = 0;

    for (const row of rows) {
      const id = String(row.id ?? '').trim();
      if (!id) continue;

      const categoryId =
        dryRun || !prisma
          ? 'dry-cat'
          : await ensureCategory(prisma, catCache, String(row.category ?? ''));

      const unitCost = Number(row.unitPrice ?? 0);
      const qty = Number(row.quantity ?? 0);
      const totalVal = Number(row.totalValue ?? 0);
      const amountForContribution = totalVal < 0 ? new Prisma.Decimal(0) : new Prisma.Decimal(totalVal);
      const lotFromRow =
        row.lot != null && String(row.lot).trim() !== ''
          ? String(row.lot)
          : null;
      const lotStr =
        lotFromRow ??
        (row.code != null && String(row.code).trim() !== ''
          ? String(row.code)
          : null);
      const supplierStr =
        row.supplier == null || String(row.supplier) === ''
          ? null
          : String(row.supplier);
      const partnerName = inferPartnerName(
        supplierStr ?? '',
        row.notes ?? '',
        lotFromRow,
      );
      partnerCounts.set(partnerName, (partnerCounts.get(partnerName) ?? 0) + 1);

      const contributionDate = d(row.purchaseDate);

      if (!dryRun && prisma) {
        await prisma.inventory.upsert({
          where: { id },
          create: {
            id,
            name: String(row.name ?? ''),
            categoryId,
            quantity: new Prisma.Decimal(qty),
            unit: String(row.unit ?? ''),
            unitCost: new Prisma.Decimal(unitCost),
            supplier: supplierStr,
            lot: lotStr,
            createdAt: d(row.createdAt),
            updatedAt: d(row.updatedAt),
          },
          update: {
            name: String(row.name ?? ''),
            categoryId,
            quantity: new Prisma.Decimal(qty),
            unit: String(row.unit ?? ''),
            unitCost: new Prisma.Decimal(unitCost),
            supplier: supplierStr,
            lot: lotStr,
            updatedAt: d(row.updatedAt),
          },
        });
        invUpserted++;

        const partnerId = await ensurePartner(prisma, partnerCache, partnerName, false);
        if (!partnerId) continue;

        const extra =
          totalVal < 0
            ? ` [totalValue original negativo: ${totalVal}]`
            : qty < 0
              ? ` [cantidad negativa en inventario: ${qty}]`
              : '';

        await prisma.partnerContribution.create({
          data: {
            partnerId,
            type: PartnerContributionType.INSUMO,
            amount: amountForContribution,
            inventoryItemId: id,
            quantity: new Prisma.Decimal(qty),
            contributionDate,
            notes: `${contributionNoteForRow(id)} | Proveedor: ${supplierStr ?? '—'} | ${String(row.notes ?? '').slice(0, 500)}${extra}`.trim(),
          },
        });
        contribCreated++;
      } else {
        invUpserted++;
        contribCreated++;
      }
    }

    console.log(`Inventario procesado (upsert): ${invUpserted} filas`);
    console.log(`Aportes por socio (INSUMO): ${contribCreated}`);
    console.log('Resumen por socio:');
    for (const [name, c] of [...partnerCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${name}: ${c}`);
    }
  } finally {
    if (prisma) await prisma.$disconnect();
    if (pool) await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
