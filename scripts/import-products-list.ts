import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { CategoryType, Prisma, PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

/**
 * Importa productos desde el CSV (Nombre, Descripción, Precio, Tamaño, Categoría).
 * - Categorías de menú (7): Cafetería, Bar, Cócteles, Shots, Botellas, Comida, Combos.
 *   En `categories.name` se guarda el nombre en español; en `Product.type` el slug (cafeteria, bar, …).
 * - CSV columna Categoría: cafeteria | bar | cocteles | shots | botellas | comida | combos
 *   (se aceptan aliases viejos: cafe, coctel, cerveza, licores, shot, combo, etc.)
 *
 * Pasada extra: alinea por **id canónico** (slug del nombre) y **elimina duplicados** (UUID viejos)
 * para que en Prisma Studio no queden filas sin tamaño.
 *
 * Uso:
 *   npx ts-node --transpile-only scripts/import-products-list.ts
 *   npx ts-node --transpile-only scripts/import-products-list.ts --file "/ruta/lista.csv"
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  let file = path.resolve(process.cwd(), 'prisma/data/lista-productos.csv');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file' && argv[i + 1]) file = path.resolve(argv[++i]);
  }
  return { file };
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  while (i < content.length) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((cell) => cell.trim()));
}

function parsePrice(raw: string): number {
  let s = raw.replace(/\$/g, '').replace(/\s/g, '');
  s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Precio inválido: ${raw}`);
  return n;
}

/** Slug estable para `Product.id` y para emparejar duplicados. */
function canonicalProductId(name: string): string {
  const n = name
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return n
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Slug de categoría: conserva `snake_case` del CSV (solo normaliza espacios). */
function slugCategory(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Slug → nombre único en `categories` (lo que ves en Prisma Studio). */
const SLUG_TO_CATEGORY_NAME: Record<string, string> = {
  cafeteria: 'Cafetería',
  bar: 'Bar',
  cocteles: 'Cócteles',
  shots: 'Shots',
  botellas: 'Botellas',
  comida: 'Comida',
  combos: 'Combos',
};

const ALLOWED_MENU_SLUGS = new Set(Object.keys(SLUG_TO_CATEGORY_NAME));

/** Mapea CSV viejos u hoja Excel a los 7 slugs nuevos. */
function normalizeMenuCategory(raw: string): string {
  let s = slugCategory(raw);
  const legacy: Record<string, string> = {
    cafe: 'cafeteria',
    bebida_caliente: 'cafeteria',
    bebida_fria: 'cafeteria',
    postre: 'cafeteria',
    coctel: 'cocteles',
    cerveza: 'bar',
    licores: 'botellas',
    licor: 'botellas',
    shot: 'shots',
    combo: 'combos',
  };
  if (legacy[s]) s = legacy[s];
  return s;
}

function isHeaderRow(cols: string[]): boolean {
  const a = (cols[0] || '').toLowerCase();
  return a === 'nombre' || a.startsWith('nombre');
}

function isProductRow(cols: string[]): boolean {
  if (cols.length < 5) return false;
  const name = (cols[0] || '').trim();
  const cat = (cols[4] || '').trim();
  if (!name || !cat) return false;
  if (isHeaderRow(cols)) return false;
  return true;
}

function rowsFromCsv(content: string) {
  const grid = parseCsv(content);
  const out: Array<{
    name: string;
    description: string;
    price: number;
    size: string;
    categorySlug: string;
  }> = [];
  for (const cols of grid) {
    if (!isProductRow(cols)) continue;
    const name = cols[0].trim();
    const description = cols[1].trim();
    const price = parsePrice(cols[2]);
    const sizeRaw = cols[3].trim();
    const categorySlug = normalizeMenuCategory(cols[4].trim());
    if (!sizeRaw) throw new Error(`CSV: falta Tamaño para "${name}"`);
    if (!ALLOWED_MENU_SLUGS.has(categorySlug)) {
      throw new Error(
        `CSV: categoría no permitida "${cols[4].trim()}" → "${categorySlug}" (${name})`,
      );
    }
    out.push({
      name,
      description,
      price,
      size: sizeRaw,
      categorySlug,
    });
  }
  return out;
}

async function ensureProductCategoryId(
  prisma: PrismaClient,
  cache: Map<string, string>,
  categorySlug: string,
): Promise<string> {
  const slug = normalizeMenuCategory(categorySlug);
  if (!ALLOWED_MENU_SLUGS.has(slug)) {
    throw new Error(`Categoría no permitida al resolver FK: ${categorySlug}`);
  }
  const hit = cache.get(slug);
  if (hit) return hit;
  const name = SLUG_TO_CATEGORY_NAME[slug];
  const row = await prisma.category.upsert({
    where: { name },
    create: { name, type: CategoryType.PRODUCT },
    update: {},
    select: { id: true },
  });
  cache.set(slug, row.id);
  return row.id;
}

async function deleteOrphanProductCategories(
  prisma: PrismaClient,
  catCache: Map<string, string>,
) {
  const keep = new Set(Object.values(SLUG_TO_CATEGORY_NAME));
  const rows = await prisma.category.findMany({
    where: { type: CategoryType.PRODUCT },
    select: { id: true, name: true },
  });
  const fallbackId = await ensureProductCategoryId(prisma, catCache, 'cafeteria');
  for (const c of rows) {
    if (keep.has(c.name)) continue;
    const total = await prisma.product.count({ where: { categoryId: c.id } });
    if (total === 0) {
      await prisma.category.delete({ where: { id: c.id } });
      console.log('Categoría antigua eliminada:', c.name);
      continue;
    }
    const visible = await prisma.product.count({
      where: { categoryId: c.id, deletedAt: null },
    });
    if (visible > 0) {
      console.warn(`Categoría "${c.name}" no eliminada: ${visible} productos visibles`);
      continue;
    }
    await prisma.product.updateMany({
      where: { categoryId: c.id },
      data: { categoryId: fallbackId, type: 'cafeteria' },
    });
    await prisma.category.delete({ where: { id: c.id } });
    console.log('Categoría antigua eliminada (solo históricos):', c.name);
  }
}

async function main() {
  const { file } = parseArgs();
  if (!fs.existsSync(file)) {
    throw new Error(`No existe el archivo: ${file}`);
  }
  const content = fs.readFileSync(file, 'utf8');
  const PRODUCTS = rowsFromCsv(content);

  const byId = new Map<string, (typeof PRODUCTS)[number]>();
  for (const p of PRODUCTS) {
    const id = canonicalProductId(p.name);
    if (!id) throw new Error(`Id vacío para: ${p.name}`);
    if (byId.has(id)) {
      throw new Error(`Colisión de id "${id}": "${byId.get(id)!.name}" vs "${p.name}"`);
    }
    byId.set(id, p);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const catCache = new Map<string, string>();

  try {
    const canonicalIds = [...byId.keys()];

    for (const p of PRODUCTS) {
      const id = canonicalProductId(p.name);
      const type = p.categorySlug;
      const categoryId = await ensureProductCategoryId(prisma, catCache, p.categorySlug);

      await prisma.product.upsert({
        where: { id },
        create: {
          id,
          name: p.name,
          description: p.description,
          price: new Prisma.Decimal(p.price),
          type,
          size: p.size,
          imageUrl: null,
          categoryId,
          active: true,
        },
        update: {
          name: p.name,
          description: p.description,
          price: new Prisma.Decimal(p.price),
          type,
          size: p.size,
          categoryId,
          active: true,
          deletedAt: null,
        },
      });
    }

    const visible = await prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    for (const row of visible) {
      const expectedId = canonicalProductId(row.name);
      const p = byId.get(expectedId);
      if (!p) {
        await prisma.product.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
        continue;
      }
      if (row.id !== expectedId) {
        await prisma.product.update({
          where: { id: row.id },
          data: { deletedAt: new Date() },
        });
        continue;
      }
      const type = p.categorySlug;
      const categoryId = await ensureProductCategoryId(prisma, catCache, p.categorySlug);
      await prisma.product.update({
        where: { id: row.id },
        data: {
          name: p.name,
          description: p.description,
          price: new Prisma.Decimal(p.price),
          type,
          size: p.size,
          categoryId,
          active: true,
          deletedAt: null,
        },
      });
    }

    await prisma.product.updateMany({
      where: { id: { notIn: canonicalIds }, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    const sinTam = await prisma.product.count({
      where: {
        deletedAt: null,
        OR: [{ size: null }, { size: '' }],
      },
    });
    if (sinTam > 0) {
      throw new Error(`Quedaron ${sinTam} productos visibles sin tamaño (revisa el CSV o duplicados).`);
    }

    const totalVisible = await prisma.product.count({ where: { deletedAt: null } });

    await deleteOrphanProductCategories(prisma, catCache);

    console.log(`CSV: ${file}`);
    console.log(`Filas CSV: ${PRODUCTS.length}`);
    console.log(`Productos visibles: ${totalVisible}`);
    console.log(`Categorías PRODUCT (menú): ${catCache.size}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
