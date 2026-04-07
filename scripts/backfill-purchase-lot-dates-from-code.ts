import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Ajusta `purchase_lots.purchase_date` infiriéndola del código de lote (`code`),
 * mismo valor que `inventory.lot`.
 *
 * Modos:
 * - Por defecto: solo filas existentes en `purchase_lots`.
 * - `--from-inventory`: agrupa `inventory.lot` (activo), crea/actualiza `purchase_lots`
 *   y aplica fecha inferida (útil si la tabla de lotes está vacía o desactualizada).
 *
 *   npm run db:backfill-purchase-lot-dates-from-code
 *   npm run db:backfill-purchase-lot-dates-from-code -- --dry-run
 *   npm run db:backfill-purchase-lot-dates-from-code -- --from-inventory
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: argv.includes('--dry-run'),
    fromInventory: argv.includes('--from-inventory'),
  };
}

function utcNoon(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
}

function isValidYmd(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1990 || y > 2100)
    return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function dateFromEightDigits(raw: string): Date | null {
  if (!/^\d{8}$/.test(raw)) return null;
  const y = Number(raw.slice(0, 4));
  const m = Number(raw.slice(4, 6));
  const d = Number(raw.slice(6, 8));
  if (isValidYmd(y, m, d)) return utcNoon(y, m, d);
  const d2 = Number(raw.slice(0, 2));
  const m2 = Number(raw.slice(2, 4));
  const y2 = Number(raw.slice(4, 8));
  if (isValidYmd(y2, m2, d2)) return utcNoon(y2, m2, d2);
  return null;
}

function inferFromHyphenSegments(code: string): Date | null {
  const parts = code.split('-');
  for (const p of parts) {
    if (/^\d{8}$/.test(p)) {
      const dt = dateFromEightDigits(p);
      if (dt) return dt;
    }
  }
  return null;
}

function inferFromFirstEightDigitRun(code: string): Date | null {
  const re = /\d{8}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const dt = dateFromEightDigits(m[0]);
    if (dt) return dt;
  }
  return null;
}

function inferPurchaseDateFromLotCode(code: string): Date | null {
  const c = (code ?? '').trim();
  if (!c || c.toLowerCase() === 'lot') return null;

  const head = c.match(/^(\d{8})-/);
  if (head) {
    const dt = dateFromEightDigits(head[1]);
    if (dt) return dt;
  }

  const fromSeg = inferFromHyphenSegments(c);
  if (fromSeg) return fromSeg;

  return inferFromFirstEightDigitRun(c);
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

const IGNORE_LOT_PREFIXES = ['seed:receta', 'seed:insumo'];

function shouldIgnoreLotCode(code: string): boolean {
  const c = code.trim().toLowerCase();
  return IGNORE_LOT_PREFIXES.some((p) => c.startsWith(p));
}

async function syncFromInventory(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<void> {
  const inv = await prisma.inventory.findMany({
    where: {
      deletedAt: null,
      lot: { not: null },
    },
    select: {
      lot: true,
      supplier: true,
      quantity: true,
      unitCost: true,
    },
  });

  type Agg = {
    itemCount: number;
    totalValue: Prisma.Decimal;
    suppliers: string[];
  };
  const byCode = new Map<string, Agg>();

  for (const row of inv) {
    const code = (row.lot ?? '').trim();
    if (!code || shouldIgnoreLotCode(code)) continue;

    let a = byCode.get(code);
    if (!a) {
      a = {
        itemCount: 0,
        totalValue: new Prisma.Decimal(0),
        suppliers: [],
      };
      byCode.set(code, a);
    }
    a.itemCount += 1;
    a.totalValue = a.totalValue.add(row.quantity.mul(row.unitCost));
    const s = (row.supplier ?? '').trim();
    if (s) a.suppliers.push(s);
  }

  let created = 0;
  let updated = 0;
  let skippedNoDate = 0;

  const codes = [...byCode.keys()].sort();

  for (const code of codes) {
    const agg = byCode.get(code)!;
    const inferred = inferPurchaseDateFromLotCode(code);
    const supplier =
      agg.suppliers.find((x) => x.length > 0) ?? null;

    const existing = await prisma.purchaseLot.findUnique({
      where: { code },
      select: { id: true, purchaseDate: true },
    });

    const purchaseDate =
      inferred ?? existing?.purchaseDate ?? null;

    if (!purchaseDate) {
      skippedNoDate++;
      console.log(
        `[skip] ${code} — sin fecha inferible y no existe fila previa en purchase_lots`,
      );
      continue;
    }

    const wouldChangeDate =
      !existing ||
      (inferred != null && !sameCalendarDay(inferred, existing.purchaseDate));

    if (!existing) {
      console.log(
        `[${dryRun ? 'dry' : 'create'}] ${code} → ${purchaseDate.toISOString().slice(0, 10)} (${agg.itemCount} ítems inv.)`,
      );
      if (!dryRun) {
        await prisma.purchaseLot.create({
          data: {
            code,
            purchaseDate,
            supplier,
            itemCount: agg.itemCount,
            totalValue: agg.totalValue,
            notes: inferred
              ? 'Fecha inferida desde código de lote'
              : null,
          },
        });
      }
      created++;
      continue;
    }

    const newPd = inferred ?? existing.purchaseDate;
    if (inferred && !sameCalendarDay(inferred, existing.purchaseDate)) {
      console.log(
        `[${dryRun ? 'dry' : 'set'}] ${code} — ${existing.purchaseDate.toISOString().slice(0, 10)} → ${inferred.toISOString().slice(0, 10)}`,
      );
    } else {
      console.log(
        `[${dryRun ? 'dry' : 'sync'}] ${code} — agregados itemCount/totalValue/proveedor desde inventario`,
      );
    }

    if (!dryRun) {
      await prisma.purchaseLot.update({
        where: { id: existing.id },
        data: {
          purchaseDate: newPd,
          supplier,
          itemCount: agg.itemCount,
          totalValue: agg.totalValue,
        },
      });
    }
    updated++;
  }

  console.log(
    `\n[from-inventory] códigos en inventario: ${codes.length}, creados ${created}${dryRun ? ' (dry-run)' : ''}, actualizados/ sincronizados ${updated}, sin fecha ${skippedNoDate}`,
  );
}

async function updateExistingLotsOnly(
  prisma: PrismaClient,
  dryRun: boolean,
): Promise<void> {
  const lots = await prisma.purchaseLot.findMany({
    select: { id: true, code: true, purchaseDate: true },
    orderBy: { code: 'asc' },
  });

  if (lots.length === 0) {
    console.log(
      '\nNo hay filas en `purchase_lots`. Ejecuta con --from-inventory para crearlas desde `inventory.lot`, o:\n  npm run db:register-purchase-lots\n',
    );
    return;
  }

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const row of lots) {
    const inferred = inferPurchaseDateFromLotCode(row.code);
    if (!inferred) {
      skipped++;
      console.log(`[skip] ${row.code} — sin fecha inferible`);
      continue;
    }
    if (sameCalendarDay(inferred, row.purchaseDate)) {
      unchanged++;
      continue;
    }
    console.log(
      `[${dryRun ? 'dry' : 'set'}] ${row.code} — ${row.purchaseDate.toISOString().slice(0, 10)} → ${inferred.toISOString().slice(0, 10)}`,
    );
    if (!dryRun) {
      await prisma.purchaseLot.update({
        where: { id: row.id },
        data: { purchaseDate: inferred },
      });
    }
    updated++;
  }

  console.log(
    `\nResumen: total ${lots.length}, actualizados ${updated}${dryRun ? ' (dry-run)' : ''}, ya coincidían ${unchanged}, sin inferencia ${skipped}`,
  );
}

async function main() {
  const { dryRun, fromInventory } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    if (fromInventory) {
      await syncFromInventory(prisma, dryRun);
    } else {
      await updateExistingLotsOnly(prisma, dryRun);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
