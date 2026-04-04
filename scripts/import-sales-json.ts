import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient, SaleSource } from '@prisma/client';
import { Pool } from 'pg';
import { matchSaleLineToCatalog, normalizeProductLabel } from './lib/sale-line-product-match';
import { computeSaleLineCostProfit } from '../src/sales/recipe-sale-line-cost';

type SaleJson = {
  id: string;
  saleDate: string;
  hour?: number;
  items?: Array<{
    productId?: string;
    productName?: string;
    quantity?: number;
    price?: number;
  }>;
  total: number;
  paymentMethod?: string | null;
  notes?: string | null;
  mesa?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'prisma/data/tables/sales.json');
  let skipExisting = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) file = path.resolve(argv[++i]);
    if (argv[i] === '--force') skipExisting = false;
  }
  return { file, skipExisting };
}

function d(iso: string | null | undefined): Date | undefined {
  if (iso == null || iso === '') return undefined;
  return new Date(iso);
}

/**
 * Importa ventas desde JSON (histórico). Enlaza líneas al catálogo actual por nombre
 * y calcula `cost_at_sale` / `profit` con la receta vigente.
 *
 * Uso:
 *   npm run db:import-sales-json
 *   npm run db:import-sales-json -- --file /ruta/ventas.json
 *   npm run db:import-sales-json -- --force   (recrea ventas con mismo id → falla si existen; usar solo en DB vacía)
 */
async function main() {
  const { file, skipExisting } = parseArgs();
  if (!fs.existsSync(file)) throw new Error(`No existe: ${file}`);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const raw = fs.readFileSync(file, 'utf8');
  const sales = JSON.parse(raw) as SaleJson[];

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const products = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });
    const nameToId = new Map<string, { id: string; name: string }>();
    for (const p of products) {
      nameToId.set(normalizeProductLabel(p.name), p);
    }

    let created = 0;
    let skipped = 0;
    let linesTotal = 0;
    let linesLinked = 0;

    for (const row of sales) {
      const saleId = String(row.id ?? '');
      if (!saleId) continue;

      if (skipExisting) {
        const ex = await prisma.sale.findUnique({
          where: { id: saleId },
          select: { id: true },
        });
        if (ex) {
          skipped++;
          continue;
        }
      }

      const items = Array.isArray(row.items) ? row.items : [];
      const lineCreates: Prisma.SaleLineCreateWithoutSaleInput[] = [];

      for (const item of items) {
        const productName = String(item.productName ?? '');
        const qty = new Prisma.Decimal(Number(item.quantity ?? 0));
        const unitPrice = new Prisma.Decimal(Number(item.price ?? 0));
        linesTotal++;

        const hit = matchSaleLineToCatalog(productName, nameToId);
        let productId: string | null = null;
        let costAtSale: Prisma.Decimal | null = null;
        let profit: Prisma.Decimal | null = null;

        if (hit) {
          productId = hit.productId;
          linesLinked++;
          const cp = await computeSaleLineCostProfit(
            prisma,
            hit.productId,
            qty,
            unitPrice,
            hit.recipeCostMultiplier,
          );
          costAtSale = cp.costAtSale;
          profit = cp.profit;
        }

        lineCreates.push({
          ...(productId
            ? { product: { connect: { id: productId } } }
            : {}),
          productName: productName || '(sin nombre)',
          quantity: qty,
          unitPrice,
          costAtSale,
          profit,
        });
      }

      await prisma.sale.create({
        data: {
          id: saleId,
          saleDate: d(row.saleDate) ?? new Date(),
          total: new Prisma.Decimal(Number(row.total ?? 0)),
          paymentMethod:
            row.paymentMethod == null ? null : String(row.paymentMethod),
          notes: row.notes == null ? null : String(row.notes),
          mesa: row.mesa == null ? null : String(row.mesa),
          source: SaleSource.MANUAL,
          createdAt: d(row.createdAt) ?? new Date(),
          updatedAt: d(row.updatedAt) ?? new Date(),
          lines: { create: lineCreates },
        },
      });
      created++;
    }

    console.log(
      `Ventas creadas: ${created}, omitidas (ya existían): ${skipped}, líneas: ${linesTotal}, enlazadas a producto: ${linesLinked}`,
    );
    console.log(
      'Ejecuta `npm run db:backfill-sale-lines` si ajustas reglas o recetas después.',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
