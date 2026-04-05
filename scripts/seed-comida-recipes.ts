import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { RecipeSpec, seedRecipeSpecs } from './lib/sheet-recipe-seed';

/**
 * Recetas categoría Comida (misma estructura que la hoja de costos).
 * Requiere productos en DB (`npm run db:sync-products`); incluye **Hot Dog en combo**
 * definido en `prisma/data/lista-productos.csv`.
 *
 * Uso: npm run db:seed-comida-recipes
 */

const RECIPES: RecipeSpec[] = [
  {
    productName: 'Tostadas',
    lines: [
      {
        ingredient: 'Tostada integral',
        qty: 1,
        unit: 'und',
        sheetUnitCost: '$400',
        lineTotalCOP: 400,
      },
      {
        ingredient: 'Mantequilla / mermelada',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 400,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 240,
      },
    ],
  },
  {
    productName: 'Hot Dog',
    lines: [
      {
        ingredient: 'Pan suave',
        qty: 1,
        unit: 'und',
        sheetUnitCost: '—',
        lineTotalCOP: 800,
      },
      {
        ingredient: 'Salchicha premium',
        qty: 1,
        unit: 'und',
        sheetUnitCost: '—',
        lineTotalCOP: 2500,
      },
      {
        ingredient: 'Queso',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 800,
      },
      {
        ingredient: 'Papa triturada',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Salsas',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 300,
      },
      {
        ingredient: 'Jalapeños',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 300,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1560,
      },
    ],
  },
  {
    productName: 'Hot Dog en combo',
    lines: [
      {
        ingredient: 'Hot Dog base',
        qty: 1,
        unit: 'und',
        sheetUnitCost: '—',
        lineTotalCOP: 5200,
      },
      {
        ingredient: 'Gaseosa (vaso)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1000,
      },
      {
        ingredient: 'Papas chips',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2310,
      },
    ],
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const n = await seedRecipeSpecs(prisma, RECIPES, 'Comida');
    console.log('Listo. Recetas aplicadas:', n, '/', RECIPES.length);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
