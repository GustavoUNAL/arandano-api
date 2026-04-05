import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { RecipeSpec, seedRecipeSpecs } from './lib/sheet-recipe-seed';

/**
 * Recetas cafetería (misma estructura que la hoja de costos).
 * Uso: npm run db:seed-cafeteria-recipes
 */

const RECIPES: RecipeSpec[] = [
  {
    productName: 'Café negro artesanal',
    lines: [
      {
        ingredient: 'Café molido',
        qty: 15,
        unit: 'g',
        sheetUnitCost: '$81,5/g',
        lineTotalCOP: 1222,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 180,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 637,
      },
    ],
  },
  {
    productName: 'Café aromatizado',
    lines: [
      {
        ingredient: 'Café molido',
        qty: 15,
        unit: 'g',
        sheetUnitCost: '$81,5/g',
        lineTotalCOP: 1222,
      },
      {
        ingredient: 'Aromatizante',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 100,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 180,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 667,
      },
    ],
  },
  {
    productName: 'Carajillo',
    lines: [
      {
        ingredient: 'Café molido',
        qty: 15,
        unit: 'g',
        sheetUnitCost: '$81,5/g',
        lineTotalCOP: 1222,
      },
      {
        ingredient: 'Aguardiente nariño',
        qty: 30,
        unit: 'ml',
        sheetUnitCost: '$75/ml',
        lineTotalCOP: 2250,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 120,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 1312,
      },
    ],
  },
  {
    productName: 'Café con leche',
    lines: [
      {
        ingredient: 'Café molido',
        qty: 15,
        unit: 'g',
        sheetUnitCost: '$81,5/g',
        lineTotalCOP: 1222,
      },
      {
        ingredient: 'Leche',
        qty: 60,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 120,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 787,
      },
    ],
  },
  {
    productName: 'Café irlandés',
    lines: [
      {
        ingredient: 'Café molido',
        qty: 15,
        unit: 'g',
        sheetUnitCost: '$81,5/g',
        lineTotalCOP: 1222,
      },
      {
        ingredient: 'Whisky para cóctel',
        qty: 60,
        unit: 'ml',
        sheetUnitCost: '$80/ml',
        lineTotalCOP: 4800,
      },
      {
        ingredient: 'Leche',
        qty: 60,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 90,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 2227,
      },
    ],
  },
  {
    productName: 'Vaso de leche',
    lines: [
      {
        ingredient: 'Leche',
        qty: 240,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 2000,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 600,
      },
    ],
  },
  {
    productName: 'Café frapé',
    lines: [
      {
        ingredient: 'Café preparado',
        qty: 120,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 1200,
      },
      {
        ingredient: 'Leche',
        qty: 60,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Hielo',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 200,
      },
      {
        ingredient: 'Azúcar',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 100,
      },
      {
        ingredient: 'Chispas de chocolate',
        qty: 10,
        unit: 'g',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Arequipe',
        qty: 20,
        unit: 'g',
        sheetUnitCost: '—',
        lineTotalCOP: 600,
      },
      {
        ingredient: 'Chantilly (lata)',
        qty: 30,
        unit: 'g',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
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
        lineTotalCOP: 1470,
      },
    ],
  },
  {
    productName: 'Affogato',
    lines: [
      {
        ingredient: 'Espresso',
        qty: 60,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 1200,
      },
      {
        ingredient: 'Helado',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 3000,
      },
      {
        ingredient: 'Administración (30%)',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1260,
      },
    ],
  },
  {
    productName: 'Leche achocolatada',
    lines: [
      {
        ingredient: 'Leche',
        qty: 180,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 1500,
      },
      {
        ingredient: 'Chocolate',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 800,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 750,
      },
    ],
  },
  {
    productName: 'Aromática con fruta',
    lines: [
      {
        ingredient: 'Aromática',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Fruta',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1000,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 200,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 720,
      },
    ],
  },
  {
    productName: 'Aromática',
    lines: [
      {
        ingredient: 'Aromática',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 500,
      },
      {
        ingredient: 'Agua (Indirecto)',
        qty: 200,
        unit: 'ml',
        sheetUnitCost: '—',
        lineTotalCOP: 700,
      },
      {
        ingredient: 'Energía (Indirecto)',
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
        lineTotalCOP: 520,
      },
    ],
  },
  {
    productName: 'Jarra de aromática con fruta',
    lines: [
      {
        ingredient: 'Aromática',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 1000,
      },
      {
        ingredient: 'Fruta',
        qty: null,
        unit: 'porción',
        sheetUnitCost: '—',
        lineTotalCOP: 3000,
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
        lineTotalCOP: 1560,
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
    const n = await seedRecipeSpecs(prisma, RECIPES, 'Cafetería');
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
