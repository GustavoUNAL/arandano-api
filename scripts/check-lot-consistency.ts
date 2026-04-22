import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL no está definida.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const [q1, q2, q3, q4, q5] = await Promise.all([
      prisma.$queryRaw<Array<{ c: number }>>`
        select count(*)::int as c
        from inventory
        where deleted_at is null
          and (lot is null or btrim(lot) = '')
      `,
      prisma.$queryRaw<Array<{ c: number }>>`
        select count(*)::int as c
        from inventory i
        left join purchase_lots pl on pl.code = i.lot
        where i.deleted_at is null
          and i.lot is not null
          and pl.code is null
      `,
      prisma.$queryRaw<Array<{ c: number }>>`
        select count(*)::int as c
        from purchase_lots pl
        where exists (
          select 1
          from inventory i
          where i.deleted_at is null
            and i.lot = pl.code
        )
          and (pl.total_value is null or pl.total_value <= 0)
      `,
      prisma.$queryRaw<Array<{ c: number }>>`
        select count(*)::int as c
        from purchase_lot_lines
      `,
      prisma.$queryRaw<Array<{ c: number }>>`
        select count(*)::int as c
        from purchase_lot_lines l
        left join inventory i on i.id = l.inventory_item_id
        where l.inventory_item_id is not null
          and (i.id is null or i.deleted_at is not null)
      `,
    ]);

    console.log(
      JSON.stringify(
        {
          activeInventoryWithoutLot: q1[0]?.c ?? 0,
          activeInventoryWithMissingLot: q2[0]?.c ?? 0,
          activeReferencedLotsWithoutTotalValue: q3[0]?.c ?? 0,
          purchaseLotLines: q4[0]?.c ?? 0,
          orphanedOrArchivedLinkedLines: q5[0]?.c ?? 0,
        },
        null,
        2,
      ),
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
