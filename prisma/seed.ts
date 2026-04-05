import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  CategoryType,
  PartnerContributionType,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const passwordHash = await bcrypt.hash('admin123', 10);

    const admin = await prisma.user.upsert({
      where: { email: 'admin@arandano.local' },
      create: {
        email: 'admin@arandano.local',
        passwordHash,
        name: 'Administrador',
        role: UserRole.ADMIN,
        active: true,
      },
      update: {
        passwordHash,
        role: UserRole.ADMIN,
      },
    });

    const catProduct = await prisma.category.upsert({
      where: { name: 'Menú — Bebidas' },
      create: { name: 'Menú — Bebidas', type: CategoryType.PRODUCT },
      update: {},
    });

    const catInventory = await prisma.category.upsert({
      where: { name: 'Insumos (demo)' },
      create: { name: 'Insumos (demo)', type: CategoryType.INVENTORY },
      update: {},
    });

    const catExpense = await prisma.category.upsert({
      where: { name: 'Gastos operativos' },
      create: { name: 'Gastos operativos', type: CategoryType.EXPENSE },
      update: {},
    });

    const invCoffee = await prisma.inventory.create({
      data: {
        name: 'Café en grano',
        categoryId: catInventory.id,
        quantity: new Prisma.Decimal('25.0000'),
        unit: 'g',
        unitCost: new Prisma.Decimal('0.08'),
        supplier: 'Proveedor demo',
        minStock: new Prisma.Decimal('5.0000'),
      },
    });

    const invMilk = await prisma.inventory.create({
      data: {
        name: 'Leche entera',
        categoryId: catInventory.id,
        quantity: new Prisma.Decimal('10.0000'),
        unit: 'ml',
        unitCost: new Prisma.Decimal('0.002'),
        minStock: new Prisma.Decimal('2.0000'),
      },
    });

    const invBread = await prisma.inventory.create({
      data: {
        name: 'Pan brioche',
        categoryId: catInventory.id,
        quantity: new Prisma.Decimal('30.0000'),
        unit: 'unidad',
        unitCost: new Prisma.Decimal('1.20'),
        minStock: new Prisma.Decimal('10.0000'),
      },
    });

    const prodDrink = await prisma.product.create({
      data: {
        name: 'Cappuccino',
        description: 'Espresso con leche espumada',
        price: new Prisma.Decimal('4.50'),
        categoryId: catProduct.id,
        type: 'bebida',
        active: true,
      },
    });

    const prodFood = await prisma.product.create({
      data: {
        name: 'Sandwich club',
        description: 'Pollo, pan brioche, vegetales',
        price: new Prisma.Decimal('8.90'),
        categoryId: catProduct.id,
        type: 'comida',
        active: true,
      },
    });

    const recipeDrink = await prisma.recipe.create({
      data: {
        productId: prodDrink.id,
        recipeYield: new Prisma.Decimal('1'),
        ingredients: {
          create: [
            {
              inventoryItemId: invCoffee.id,
              quantity: new Prisma.Decimal('18.0000'),
              unit: 'g',
            },
            {
              inventoryItemId: invMilk.id,
              quantity: new Prisma.Decimal('180.0000'),
              unit: 'ml',
            },
          ],
        },
      },
    });

    const recipeFood = await prisma.recipe.create({
      data: {
        productId: prodFood.id,
        recipeYield: new Prisma.Decimal('1'),
        ingredients: {
          create: [
            {
              inventoryItemId: invBread.id,
              quantity: new Prisma.Decimal('2.0000'),
              unit: 'unidad',
            },
            {
              inventoryItemId: invMilk.id,
              quantity: new Prisma.Decimal('30.0000'),
              unit: 'ml',
            },
          ],
        },
      },
    });

    await prisma.expense.create({
      data: {
        description: 'Servicios (demo)',
        amount: new Prisma.Decimal('42.00'),
        expenseDate: new Date(),
        categoryId: catExpense.id,
        userId: admin.id,
        type: 'variable',
        relatedTo: 'utilities',
      },
    });

    const partner = await prisma.partner.create({
      data: {
        name: 'Socio demo',
        email: 'socio@arandano.local',
        active: true,
      },
    });

    await prisma.partnerContribution.create({
      data: {
        partnerId: partner.id,
        type: PartnerContributionType.DINERO,
        amount: new Prisma.Decimal('500.00'),
        contributionDate: new Date(),
        notes: 'Aporte inicial de capital',
      },
    });

    console.log('Seed OK:', {
      adminId: admin.id,
      categories: [catProduct.id, catInventory.id, catExpense.id],
      inventory: [invCoffee.id, invMilk.id, invBread.id],
      products: [prodDrink.id, prodFood.id],
      recipes: [recipeDrink.id, recipeFood.id],
      partnerId: partner.id,
    });
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
