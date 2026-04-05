import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { RecipeSpec, seedRecipeSpecs } from './lib/sheet-recipe-seed';

/**
 * Recetas Bar, Cócteles y Shots (misma estructura que la hoja de costos).
 * Nombres de `productName` = columna Nombre del CSV (`lista-productos.csv`).
 *
 * Uso: npm run db:seed-bar-cocteles-shots-recipes
 */

const RECIPES: RecipeSpec[] = [
  {
    productName: 'Cerveza Michelada',
    lines: [
      {
        ingredient: 'Cerveza',
        qty: 330,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 3500,
      },
      {
        ingredient: 'Limón',
        qty: 30,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 400,
      },
      {
        ingredient: 'Sal / picante',
        qty: 1,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 100,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1200,
      },
    ],
  },
  {
    productName: 'Jarra de hervidos',
    lines: [
      {
        ingredient: 'Fruta cítrica',
        qty: 300,
        unit: 'g',
        sheetUnitCost: '—',
        lineTotalCOP: 5000,
      },
      {
        ingredient: 'Licor artesanal (cóctel)',
        qty: 213,
        unit: 'ml',
        sheetUnitCost: '$17/ml',
        lineTotalCOP: 3621,
      },
      {
        ingredient: 'Azúcar',
        qty: 80,
        unit: 'g',
        sheetUnitCost: '—',
        lineTotalCOP: 800,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 1000,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 3200,
      },
    ],
  },
  {
    productName: 'Cóctel arándano',
    lines: [
      {
        ingredient: 'Ginebra (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$3.000/oz',
        lineTotalCOP: 6000,
      },
      {
        ingredient: 'Sirope arándano',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 2400,
      },
    ],
  },
  {
    productName: 'Margarita',
    lines: [
      {
        ingredient: 'Tequila (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$3.000/oz',
        lineTotalCOP: 6000,
      },
      {
        ingredient: 'Limón',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 400,
      },
      {
        ingredient: 'Sirope',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 600,
      },
      {
        ingredient: 'Sal',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 100,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 2280,
      },
    ],
  },
  {
    productName: 'Piña colada',
    lines: [
      {
        ingredient: 'Ron (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$2.200/oz',
        lineTotalCOP: 4400,
      },
      {
        ingredient: 'Crema de coco',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2000,
      },
      {
        ingredient: 'Piña',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 2460,
      },
    ],
  },
  {
    productName: 'Negroni',
    lines: [
      {
        ingredient: 'Ginebra (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$3.000/oz',
        lineTotalCOP: 6000,
      },
      {
        ingredient: 'Campari',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 3000,
      },
      {
        ingredient: 'Naranja',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 300,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2850,
      },
    ],
  },
  {
    productName: 'Moscow mule',
    lines: [
      {
        ingredient: 'Vodka (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$2.200/oz',
        lineTotalCOP: 4400,
      },
      {
        ingredient: 'Ginger beer',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2000,
      },
      {
        ingredient: 'Limón',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 300,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2070,
      },
    ],
  },
  {
    productName: 'Gin Tonic',
    lines: [
      {
        ingredient: 'Ginebra (cóctel)',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$3.000/oz',
        lineTotalCOP: 6000,
      },
      {
        ingredient: 'Tónica',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
      },
      {
        ingredient: 'Limón',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 300,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 2400,
      },
    ],
  },
  {
    productName: 'Whisky en las rocas',
    lines: [
      {
        ingredient: 'Whisky Old Parr',
        qty: 2,
        unit: 'oz',
        sheetUnitCost: '$6.800/oz',
        lineTotalCOP: 13600,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 4140,
      },
    ],
  },
  {
    productName: 'Shot Vodka',
    lines: [
      {
        ingredient: 'Vodka Smirnoff Tamarindo',
        qty: 1,
        unit: 'oz',
        sheetUnitCost: '$2.600',
        lineTotalCOP: 2600,
      },
      {
        ingredient: 'Limón / sal',
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
        lineTotalCOP: 870,
      },
    ],
  },
  {
    productName: 'Shot Tequila',
    lines: [
      {
        ingredient: 'Tequila Olmeca',
        qty: 1,
        unit: 'oz',
        sheetUnitCost: '$4.400',
        lineTotalCOP: 4400,
      },
      {
        ingredient: 'Limón / sal',
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
        lineTotalCOP: 1410,
      },
    ],
  },
  {
    productName: 'Shot Aguardiente',
    lines: [
      {
        ingredient: 'Aguardiente Nariño / Amarillo',
        qty: 1,
        unit: 'oz',
        sheetUnitCost: '$2.600',
        lineTotalCOP: 2600,
      },
      {
        ingredient: 'Limón / sal',
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
        lineTotalCOP: 870,
      },
    ],
  },
  {
    productName: 'Shot Ginebra',
    lines: [
      {
        ingredient: 'Ginebra Gordon\u2019s',
        qty: 1,
        unit: 'oz',
        sheetUnitCost: '$3.800',
        lineTotalCOP: 3800,
      },
      {
        ingredient: 'Limón / aceituna',
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
        lineTotalCOP: 1230,
      },
    ],
  },
  {
    productName: 'Shot Whisky',
    lines: [
      {
        ingredient: 'Whisky Old Parr',
        qty: 1,
        unit: 'oz',
        sheetUnitCost: '$6.800',
        lineTotalCOP: 6800,
      },
      {
        ingredient: 'Limón',
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
        lineTotalCOP: 2130,
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
    const n = await seedRecipeSpecs(prisma, RECIPES, 'Bar/Cócteles/Shots');
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
