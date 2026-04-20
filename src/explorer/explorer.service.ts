import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { categoryDisplayName } from '../common/category-display-name';
import { PrismaService } from '../prisma/prisma.service';

/** Metadatos de columna para el front (orden = orden de visualización). */
export type ExplorerColumnDef = {
  key: string;
  label: string;
  description: string;
};

const INVENTORY_COLUMN_DEFS: ExplorerColumnDef[] = [
  {
    key: 'id',
    label: 'ID',
    description: 'Identificador único del ítem de inventario.',
  },
  {
    key: 'name',
    label: 'Insumo',
    description: 'Nombre del insumo o materia prima.',
  },
  {
    key: 'categoryId',
    label: 'ID categoría',
    description: 'Clave foránea a la categoría de inventario.',
  },
  {
    key: 'categoryName',
    label: 'Categoría',
    description: 'Nombre legible de la categoría.',
  },
  {
    key: 'quantity',
    label: 'Existencias',
    description: 'Cantidad actual en stock (estado físico).',
  },
  {
    key: 'unit',
    label: 'Unidad',
    description: 'Unidad de medida (kg, g, L, unidad, etc.).',
  },
  {
    key: 'unitCost',
    label: 'Costo unitario (COP)',
    description: 'Costo por unidad usado en valorización.',
  },
  {
    key: 'supplier',
    label: 'Proveedor',
    description: 'Referencia de proveedor habitual (texto libre).',
  },
  {
    key: 'lote',
    label: 'Lote',
    description:
      'Código de lote del ítem; debe coincidir con purchase_lots.code para traer la fecha de compra.',
  },
  {
    key: 'proveedorLote',
    label: 'Proveedor (compra)',
    description:
      'Proveedor del registro purchase_lots para este código de lote; si el lote no lo tiene, se usa el proveedor del ítem de inventario.',
  },
  {
    key: 'fechaCompra',
    label: 'Fecha compra',
    description:
      'Fecha del lote en purchase_lots (mismo code que lote). Si no hay lote o no existe el lote de compra, se indica el motivo.',
  },
  {
    key: 'movimientosSum',
    label: 'Movimientos (Σ)',
    description:
      'Suma de cantidades en stock_movements para este ítem (actividad registrada en unidades).',
  },
  {
    key: 'minStock',
    label: 'Stock mínimo',
    description: 'Umbral de alerta; por debajo conviene reporder.',
  },
  {
    key: 'deletedAt',
    label: 'Eliminado',
    description: 'Si tiene fecha, el ítem está dado de baja (soft delete).',
  },
  {
    key: 'createdAt',
    label: 'Creado',
    description: 'Alta del registro.',
  },
  {
    key: 'updatedAt',
    label: 'Actualizado',
    description: 'Última modificación.',
  },
];

const SALES_COLUMN_DEFS: ExplorerColumnDef[] = [
  {
    key: 'id',
    label: 'ID',
    description: 'Identificador único de la venta.',
  },
  {
    key: 'saleDate',
    label: 'Fecha de venta',
    description: 'Momento contable de la venta (hora incluida).',
  },
  {
    key: 'total',
    label: 'Total (COP)',
    description: 'Total cobrado de la venta.',
  },
  {
    key: 'paymentMethod',
    label: 'Método de pago',
    description: 'Texto declarado en la venta (puede coexistir con pagos gateway).',
  },
  {
    key: 'source',
    label: 'Origen',
    description: 'MANUAL, CART o AI según cómo se registró.',
  },
  {
    key: 'userId',
    label: 'ID empleado',
    description: 'Usuario que registró la venta (si aplica).',
  },
  {
    key: 'recordedByName',
    label: 'Registrado por',
    description: 'Nombre de quien registró la venta.',
  },
  {
    key: 'recordedByEmail',
    label: 'Email empleado',
    description: 'Correo del usuario que registró.',
  },
  {
    key: 'cartId',
    label: 'ID carrito',
    description: 'Carrito web asociado (si la venta viene de checkout).',
  },
  {
    key: 'cartSessionId',
    label: 'Sesión carrito',
    description: 'Identificador de sesión del carrito.',
  },
  {
    key: 'cartCustomerName',
    label: 'Cliente (carrito)',
    description: 'Nombre del usuario del carrito, si existe.',
  },
  {
    key: 'mesa',
    label: 'Mesa',
    description: 'Mesa o punto de venta (si aplica).',
  },
  {
    key: 'notes',
    label: 'Notas',
    description: 'Observaciones libres; no sustituye líneas de detalle.',
  },
  {
    key: 'lineCount',
    label: 'Líneas',
    description: 'Cantidad de líneas en sale_lines.',
  },
  {
    key: 'paymentsCount',
    label: 'Pagos',
    description: 'Cantidad de registros en payments.',
  },
  {
    key: 'stockMovementsCount',
    label: 'Movs. stock',
    description: 'Movimientos de inventario generados por la venta.',
  },
  {
    key: 'createdAt',
    label: 'Creado',
    description: 'Creación del registro en sistema.',
  },
  {
    key: 'updatedAt',
    label: 'Actualizado',
    description: 'Última modificación.',
  },
];

const TABLE_SLUGS = [
  'users',
  'categories',
  'products',
  'inventory',
  'purchase_lots',
  'recipes',
  'recipe_ingredients',
  'costos',
  'carts',
  'cart_items',
  'sales',
  'sale_lines',
  'payments',
  'stock_movements',
  'expenses',
  'admin_expenses',
  'gastos',
  'partners',
  'partner_contributions',
  'tasks',
] as const;

export type ExplorerTableSlug = (typeof TABLE_SLUGS)[number];

const SLUG_TO_DELEGATE: Record<
  ExplorerTableSlug,
  keyof PrismaService & string
> = {
  users: 'user',
  categories: 'category',
  products: 'product',
  inventory: 'inventory',
  purchase_lots: 'purchaseLot',
  recipes: 'recipe',
  recipe_ingredients: 'recipeIngredient',
  costos: 'recipeCost',
  carts: 'cart',
  cart_items: 'cartItem',
  sales: 'sale',
  sale_lines: 'saleLine',
  payments: 'payment',
  stock_movements: 'stockMovement',
  expenses: 'expense',
  admin_expenses: 'adminExpense',
  gastos: 'gasto',
  partners: 'partner',
  partner_contributions: 'partnerContribution',
  tasks: 'task',
};

function jsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Prisma.Decimal) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        jsonSafe(v),
      ]),
    );
  }
  return value;
}

@Injectable()
export class ExplorerService {
  constructor(private readonly prisma: PrismaService) {}

  listTables() {
    return TABLE_SLUGS.map((slug) => {
      const base = { slug, sqlName: slug };
      if (slug === 'inventory') {
        return {
          ...base,
          title: 'Inventario (insumos)',
          description:
            'Estado físico: existencias, costo, mínimos. Consumos en stock_movements.',
        };
      }
      if (slug === 'sales') {
        return {
          ...base,
          title: 'Ventas',
          description:
            'Registro de ventas; el detalle de productos está en sale_lines y pagos en payments.',
        };
      }
      return base;
    });
  }

  private getDelegate(slug: string) {
    if (!TABLE_SLUGS.includes(slug as ExplorerTableSlug)) {
      throw new NotFoundException(`Unknown table: ${slug}`);
    }
    const key = SLUG_TO_DELEGATE[slug as ExplorerTableSlug];
    const delegate = (this.prisma as unknown as Record<string, unknown>)[key];
    if (
      !delegate ||
      typeof (delegate as { count?: unknown }).count !== 'function'
    ) {
      throw new NotFoundException(`No delegate for: ${slug}`);
    }
    return delegate as {
      count: (args?: object) => Promise<number>;
      findMany: (args: object) => Promise<Record<string, unknown>[]>;
    };
  }

  async getTableRows(
    slug: string,
    limit: number,
    offset: number,
  ): Promise<{
    total: number;
    rows: unknown[];
    columns: string[];
    columnDefs?: ExplorerColumnDef[];
  }> {
    const take = Math.min(Math.max(limit, 1), 500);
    const skip = Math.max(offset, 0);

    if (slug === 'inventory') {
      return this.getInventoryExplorerRows(take, skip);
    }
    if (slug === 'sales') {
      return this.getSalesExplorerRows(take, skip);
    }

    const delegate = this.getDelegate(slug);

    const [total, rows] = await Promise.all([
      delegate.count(),
      delegate.findMany({
        take,
        skip,
        orderBy: { id: 'asc' },
      }),
    ]);

    const columns =
      rows.length > 0 ? Object.keys(rows[0] as object).sort() : [];

    return {
      total,
      columns,
      rows: rows.map((r) => jsonSafe(r) as unknown),
    };
  }

  /** Filas aplanadas: categoría, lote, fecha de compra vía purchase_lots y Σ movimientos. */
  private async getInventoryExplorerRows(take: number, skip: number) {
    const [total, rows] = await Promise.all([
      this.prisma.inventory.count(),
      this.prisma.inventory.findMany({
        take,
        skip,
        orderBy: { id: 'asc' },
        include: {
          category: { select: { id: true, name: true } },
        },
      }),
    ]);

    const ids = rows.map((r) => r.id);
    const lotCodes = [
      ...new Set(
        rows
          .map((r) => r.lot?.trim())
          .filter((c): c is string => !!c?.length),
      ),
    ];

    type PurchaseRow = {
      code: string;
      purchaseDate: Date;
      supplier: string | null;
    };
    const [purchaseRows, movementAgg] = await Promise.all([
      lotCodes.length
        ? this.prisma.purchaseLot.findMany({
            where: { code: { in: lotCodes } },
            select: { code: true, purchaseDate: true, supplier: true },
          })
        : Promise.resolve([] as PurchaseRow[]),
      ids.length
        ? this.prisma.stockMovement.groupBy({
            by: ['inventoryItemId'],
            where: { inventoryItemId: { in: ids } },
            _sum: { quantity: true },
          })
        : Promise.resolve([]),
    ]);

    const purchaseByCode = new Map<string, PurchaseRow>(
      purchaseRows.map((p) => [p.code, p]),
    );
    const sumByInventoryId = new Map<string, Prisma.Decimal>();
    for (const m of movementAgg) {
      sumByInventoryId.set(
        m.inventoryItemId,
        m._sum.quantity ?? new Prisma.Decimal(0),
      );
    }

    const flat = rows.map((r) => {
      const code = r.lot?.trim();
      const pl = code ? purchaseByCode.get(code) : undefined;
      const lote = code && code.length > 0 ? code : 'Sin código de lote';

      let fechaCompra: string;
      if (!code) {
        fechaCompra = 'N/D (asigna un código de lote para vincular la compra)';
      } else {
        fechaCompra = pl
          ? pl.purchaseDate.toISOString().slice(0, 10)
          : 'Sin registro en purchase_lots para este código';
      }

      const movSum = sumByInventoryId.get(r.id) ?? new Prisma.Decimal(0);
      const movimientosSum = movSum.toString();

      const proveedorLote = !code
        ? '— (sin lote)'
        : !pl
          ? '— (sin purchase_lot)'
          : pl.supplier?.trim() ||
            r.supplier?.trim() ||
            'No indicado';

      return {
        id: r.id,
        name: r.name,
        categoryId: r.categoryId,
        categoryName: categoryDisplayName(r.category.name),
        quantity: r.quantity,
        unit: r.unit,
        unitCost: r.unitCost,
        supplier: r.supplier?.trim() || 'No indicado',
        lote,
        proveedorLote,
        fechaCompra,
        movimientosSum,
        minStock:
          r.minStock !== null && r.minStock !== undefined
            ? r.minStock.toString()
            : 'Sin mínimo definido',
        deletedAt:
          r.deletedAt !== null && r.deletedAt !== undefined
            ? r.deletedAt.toISOString()
            : 'Activo',
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });

    const columns = INVENTORY_COLUMN_DEFS.map((c) => c.key);

    return {
      total,
      columns,
      columnDefs: INVENTORY_COLUMN_DEFS,
      rows: flat.map((r) => jsonSafe(r) as unknown),
    };
  }

  /** Filas aplanadas: empleado, carrito y conteos en columnas dedicadas. */
  private async getSalesExplorerRows(take: number, skip: number) {
    const [total, rows] = await Promise.all([
      this.prisma.sale.count(),
      this.prisma.sale.findMany({
        take,
        skip,
        orderBy: { id: 'asc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          cart: {
            select: {
              id: true,
              sessionId: true,
              user: { select: { name: true, email: true } },
            },
          },
          _count: {
            select: { lines: true, payments: true, stockMovements: true },
          },
        },
      }),
    ]);

    const flat = rows.map((s) => ({
      id: s.id,
      saleDate: s.saleDate,
      total: s.total,
      paymentMethod: s.paymentMethod,
      source: s.source,
      userId: s.userId,
      recordedByName: s.user?.name ?? null,
      recordedByEmail: s.user?.email ?? null,
      cartId: s.cartId,
      cartSessionId: s.cart?.sessionId ?? null,
      cartCustomerName: s.cart?.user?.name ?? null,
      mesa: s.mesa,
      notes: s.notes,
      lineCount: s._count.lines,
      paymentsCount: s._count.payments,
      stockMovementsCount: s._count.stockMovements,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    const columns = SALES_COLUMN_DEFS.map((c) => c.key);

    return {
      total,
      columns,
      columnDefs: SALES_COLUMN_DEFS,
      rows: flat.map((r) => jsonSafe(r) as unknown),
    };
  }
}
