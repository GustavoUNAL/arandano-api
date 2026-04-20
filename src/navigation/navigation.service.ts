import { Injectable } from '@nestjs/common';

/**
 * Mapa estático para el front: secciones → pantallas → endpoints HTTP.
 * `status`: `ready` (ya hay API) | `soon` (pendiente / solo lectura vía explorer).
 */
@Injectable()
export class NavigationService {
  getMenu() {
    return {
      version: 2,
      /**
       * Compras = evento financiero (qué pagaste, a quién, cuándo) → caja / gastos.
       * Inventario = estado físico (existencias, consumos, mermas, mínimos) → `inventory` + `stock_movements`.
       */
      domainModel: {
        purchases: {
          role: 'financial_entry',
          summary:
            'Flujo de entrada contable: qué compraste (lote / notas / ítems enlazados), proveedor, monto pagado, fecha.',
          impacts: [
            'Egreso de caja (monto del lote: totalValue)',
            'Planeación de gastos / compras (no reemplaza el libro mayor)',
          ],
          tables: ['purchase_lots'],
          mapsTo: {
            displayName: 'purchase_lots.name (opcional; code sigue siendo la clave)',
            supplier: 'purchase_lots.supplier',
            amountPaidCOP: 'purchase_lots.total_value',
            purchasedAt: 'purchase_lots.purchase_date',
            purchaseRef: 'purchase_lots.code',
            lineDetail:
              'Ítems físicos enlazan por inventory.lot = purchase_lots.code cuando aplica',
          },
        },
        inventory: {
          role: 'physical_stock',
          summary:
            'Estado y movimiento del recurso físico: cuánto hay hoy, consumido, mermas, mínimo.',
          tables: ['inventory', 'stock_movements'],
          mapsTo: {
            onHand: 'inventory.quantity',
            minStock: 'inventory.min_stock',
            consumptionHistory:
              'stock_movements: SALE (recetas/ventas), OUT (salidas), WASTE (mermas), IN (entradas), ADJUSTMENT (ajustes)',
          },
          listWithStats: 'GET /inventory?includeStats=true',
        },
        separationNote:
          'No confundir: `purchase_lots` documenta la compra y el pago; `inventory` + movimientos documentan el stock. Pueden enlazarse por código de lote pero son responsabilidades distintas.',
      },
      sections: [
        {
          id: 'catalog',
          title: 'Catálogo',
          subtitle: 'Carta, recetas e insumos',
          groups: [
            {
              id: 'catalog-items',
              title: 'Catálogo',
              items: [
                {
                  id: 'products',
                  label: 'Productos',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /products',
                    detail: 'GET /products/:id',
                    create: 'POST /products',
                    update: 'PATCH /products/:id',
                  },
                  tables: ['products', 'categories'],
                },
                {
                  id: 'recipes',
                  label: 'Recetas',
                  status: 'ready',
                  endpoints: {
                    catalog: 'GET /recipes',
                    costsByProduct: 'GET /recipes/costs',
                    recipeUpsert: 'PUT /products/:id/recipe',
                    costControls: 'GET /products/:id/recipe/cost-controls',
                    adminRate: 'PUT /products/:id/recipe/admin',
                  },
                  tables: ['recipes', 'recipe_ingredients', 'costos'],
                },
                {
                  id: 'inventory-insumos',
                  label: 'Inventario (insumos)',
                  domain: 'physical_stock',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /inventory',
                    listByLotCode: 'GET /inventory?lot=<purchase_lots.code>',
                    listWithMovementStats: 'GET /inventory?includeStats=true',
                    detail: 'GET /inventory/:id',
                    detailWithStats: 'GET /inventory/:id?includeStats=true',
                    create: 'POST /inventory',
                    update: 'PATCH /inventory/:id',
                  },
                  tables: ['inventory', 'stock_movements', 'categories'],
                },
              ],
            },
          ],
        },
        {
          id: 'stock',
          title: 'Stock y movimientos',
          subtitle: 'Inventario físico',
          groups: [
            {
              id: 'stock-main',
              title: 'Stock',
              items: [
                {
                  id: 'inventory',
                  label: 'Inventario',
                  domain: 'physical_stock',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /inventory?includeStats=true',
                    movements: 'GET /stock-movements',
                  },
                  tables: ['inventory', 'stock_movements'],
                },
                {
                  id: 'stock-alerts',
                  label: 'Pronto',
                  status: 'soon',
                  note:
                    'Alertas dedicadas (pendiente); hoy usa stats.belowMinimum en GET /inventory?includeStats=true',
                },
                {
                  id: 'stock-movements',
                  label: 'Movimientos',
                  domain: 'physical_stock',
                  status: 'ready',
                  endpoints: { list: 'GET /stock-movements' },
                  tables: ['stock_movements'],
                },
              ],
            },
          ],
        },
        {
          id: 'sales',
          title: 'Ventas',
          subtitle: 'Ingresos del día',
          groups: [
            {
              id: 'sales-main',
              title: 'Ventas',
              items: [
                {
                  id: 'sales-list',
                  label: 'Ventas',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /sales',
                    detail: 'GET /sales/:id',
                    create: 'POST /sales',
                  },
                  tables: ['sales', 'sale_lines', 'payments'],
                },
                {
                  id: 'sales-today',
                  label: 'Pronto',
                  status: 'soon',
                  note: 'Resumen “ingresos del día” dedicado (pendiente); filtra GET /sales con dateFrom/dateTo',
                },
                {
                  id: 'clients',
                  label: 'Clientes',
                  status: 'soon',
                  note: 'No hay CRM aún; hoy puedes inferir desde ventas/carrito',
                  tables: ['users', 'carts'],
                },
                {
                  id: 'payment-methods',
                  label: 'Métodos de pago',
                  status: 'ready',
                  endpoints: {
                    meta: 'GET /sales/meta/payment-methods',
                  },
                  tables: ['sales', 'payments'],
                },
              ],
            },
          ],
        },
        {
          id: 'purchases',
          title: 'Compras',
          subtitle: 'Evento financiero (entrada) — impacta caja y gastos',
          groups: [
            {
              id: 'purchases-main',
              title: 'Compras',
              items: [
                {
                  id: 'purchase-lots',
                  label: 'Compras (lotes)',
                  domain: 'financial_entry',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /purchase-lots',
                    detail: 'GET /purchase-lots/:id',
                    update: 'PATCH /purchase-lots/:id',
                    suppliers: 'GET /purchase-lots/meta/suppliers',
                    inventoryByLot:
                      'GET /inventory?lot=<code>&limit=100 (mismo code que el lote)',
                  },
                  tables: ['purchase_lots'],
                  note:
                    'FK: inventory.lot → purchase_lots.code (RESTRICT al borrar compra con ítems); name, proveedor, purchaseDate; totalValue = monto compra; item_count sincronizado; linkedActiveItemCount en vivo',
                },
                {
                  id: 'purchases-soon',
                  label: 'Pronto',
                  status: 'soon',
                  note: 'Órdenes de compra / facturas (pendiente)',
                },
                {
                  id: 'suppliers',
                  label: 'Proveedores',
                  status: 'ready',
                  endpoints: {
                    meta: 'GET /purchase-lots/meta/suppliers',
                  },
                  tables: ['purchase_lots', 'inventory'],
                },
              ],
            },
          ],
        },
        {
          id: 'finance',
          title: 'Finanzas',
          subtitle: 'Costos y gastos',
          groups: [
            {
              id: 'finance-main',
              title: 'Finanzas',
              items: [
                {
                  id: 'recipe-costs',
                  label: 'Costos (por producto / receta)',
                  status: 'ready',
                  endpoints: {
                    byProduct: 'GET /recipes/costs',
                    productDetail: 'GET /products/:id',
                  },
                  tables: ['costos', 'recipes'],
                },
                {
                  id: 'gastos',
                  label: 'Gastos (fijos / variables)',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /gastos',
                    upsert: 'PUT /gastos',
                    delete: 'DELETE /gastos?kind=&type=',
                  },
                  tables: ['gastos'],
                },
                {
                  id: 'admin-expenses-legacy',
                  label: 'Gastos admin (legacy)',
                  status: 'ready',
                  endpoints: {
                    list: 'GET /admin-expenses',
                    upsert: 'PUT /admin-expenses',
                  },
                  tables: ['admin_expenses'],
                },
                {
                  id: 'expenses',
                  label: 'Gastos operativos (transacciones)',
                  status: 'ready',
                  note: 'Tabla expenses; aún sin CRUD REST dedicado — usa explorer',
                  endpoints: { explorer: 'GET /explorer/tables/expenses' },
                  tables: ['expenses'],
                },
              ],
            },
          ],
        },
        {
          id: 'data',
          title: 'Datos',
          subtitle: 'Exploración',
          groups: [
            {
              id: 'data-main',
              title: 'Datos',
              items: [
                {
                  id: 'explorer',
                  label: 'Explorador de tablas',
                  status: 'ready',
                  endpoints: {
                    tables: 'GET /explorer/tables',
                    rows: 'GET /explorer/tables/:slug',
                  },
                },
                {
                  id: 'auth',
                  label: 'Auth',
                  status: 'ready',
                  endpoints: {
                    login: 'POST /auth/login',
                    me: 'GET /auth/me',
                  },
                  tables: ['users'],
                },
              ],
            },
          ],
        },
      ],
    };
  }
}
