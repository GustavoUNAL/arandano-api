# arandano-api

API en [NestJS](https://nestjs.com/) con **Prisma** y **PostgreSQL**: menú, inventario, lotes de compra, aportes de socios, ventas y datos auxiliares.

## Requisitos

- Node.js (LTS recomendado)
- PostgreSQL
- Variables en `.env` (al menos `DATABASE_URL`)

## Instalación

```bash
npm install
npm run db:generate
```

## Aplicación

```bash
npm run start:dev    # desarrollo con recarga
npm run build        # compilar
npm run start:prod   # producción (tras build)
npm run test         # tests unitarios
```

## API (rutas y funcionalidades)

Por defecto **no hay prefijo global** (`/api`), así que las rutas cuelgan directo del host (ej. `http://localhost:3000`).

### Convenciones para el frontend

- **Base URL**: `http://localhost:3000` (o el dominio donde despliegues).
- **Auth**: usa header `Authorization: Bearer <accessToken>` (por ahora solo se exige en `/auth/me`).
- **Paginación**: `page` (1-based) y `limit` (máx 100) cuando aplique.
- **Fechas**: se envían como ISO string (`YYYY-MM-DD` o `YYYY-MM-DDTHH:mm:ss.sssZ`).

### Salud

- `GET /` — respuesta simple (health/hello).

### Auth (`/auth`)

Autenticación JWT para roles `ADMIN` / `EMPLEADO`.

- `POST /auth/login` — devuelve `accessToken` (Bearer) + `user`.

  Body:

```json
{ "email": "admin@arandano.local", "password": "admin123" }
```

  Response:

```json
{
  "accessToken": "…",
  "user": { "sub": "usr_…", "email": "…", "name": "…", "role": "ADMIN" }
}
```

- `GET /auth/me` — devuelve el payload del JWT (requiere `Authorization: Bearer <token>`).

Variables:
- `JWT_SECRET` (recomendado en prod)
- `JWT_EXPIRES_IN` (ej. `7d`, `12h`)

### Productos (`/products`)

- `POST /products` — crea un producto.

  Body:

```json
{
  "name": "Café negro artesanal",
  "price": 7000,
  "categoryId": "cat_…",
  "type": "bebida",
  "description": "Opcional",
  "size": "Opcional",
  "imageUrl": "Opcional",
  "active": true
}
```

- `GET /products` — lista paginada.
  - **Query**: `page`, `limit`, `search`, `categoryId`, `active` (`true|false`), `type`, `sort` (`name|price_asc|price_desc`).

  Ejemplo:

```text
GET /products?page=1&limit=20&search=cafe&active=true&sort=name
```

- `GET /products/:id` — detalle de producto + receta (si existe).
  - **Incluye receta**:
    - **`recipe.ingredients`** (insumos físicos): `quantityOnHand`, `minStock`, `stockStatus` (`AVAILABLE|LOW|DEPLETED|ARCHIVED`), `lotCode`, `purchaseLot` (si coincide con `purchase_lots.code`), `inventoryArchived`, `sortOrder`.
    - **`recipe.costs`** (líneas de costeo): `kind` (`FIJO|VARIABLE`), `lineTotalCOP`, `sheetUnitCost`, `sortOrder`.
  - **Disponibilidad**:
    - `available`: `true` si `product.active === true` y **ningún ingrediente** está `DEPLETED`/`ARCHIVED`.
    - `recipe.available`: mismo flag (duplicado dentro de `recipe` para facilidad).
- `PATCH /products/:id` — actualiza campos del producto (incluye `active`).

  Body (todos opcionales):

```json
{ "price": 7500, "active": false }
```

- `DELETE /products/:id` — soft-delete (`deletedAt`).
- `PUT /products/:id/recipe` — crea o reemplaza receta.
  - **Body**: `recipeYield`, `adminRate?`, `ingredients?[]`, `costs?[]`.
  - `ingredients[]`: `inventoryItemId`, `quantity`, `unit`, `sortOrder?`.
  - `costs[]`: `kind`, `name`, `quantity?`, `unit`, `lineTotalCOP`, `sheetUnitCost?`, `sortOrder?`.
  - Nota: `ingredients` enlaza inventario físico (impacta stock en ventas). `costs` vive en la tabla `costos` y **no** crea inventario.
  - **Administración (30%)**:
    - El backend **siempre recalcula** la línea `Administración (…)` y **ignora** cualquier línea enviada que empiece por “Administración…”.
    - Fórmula: \(\text{adminRate}\) de \((\text{costo insumos de inventario}) + (\text{servicios/indirectos})\).
    - Servicios/indirectos se identifican por nombre (contiene `Indirecto` o empieza por `Agua`/`Energía`).
    - `adminRate` es editable por receta (default `0.30`).

- `GET /products/:id/recipe/cost-controls` — devuelve `adminRate` y totales base (`materialsCOP`, `servicesCOP`, `baseCOP`).
- `PUT /products/:id/recipe/admin` — actualiza `adminRate` del producto (recalcula administración automáticamente).

  Ejemplo:

```json
{
  "recipeYield": 1,
  "ingredients": [
    { "inventoryItemId": "inv_…", "quantity": 15, "unit": "g", "sortOrder": 0 }
  ],
  "costs": [
    {
      "kind": "FIJO",
      "name": "Administración (30%)",
      "unit": "porción",
      "lineTotalCOP": 637,
      "sortOrder": 10
    }
  ]
}
```

### Recetas (`/recipes`)

- `GET /recipes` — catálogo de recetas (por producto).
  - **Query**: `categoryId?`.
  - **Incluye**: `productActive`, `ingredientCount`, `costLineCount`, `depletedMaterialCount`, `lowStockMaterialCount`.
- `GET /recipes/costs` — líneas en `costos` agrupadas por producto:
  - `products[]`: cada producto trae `fixed[]` y `variable[]`, además de `rows[]` (flat ordenado) + `totals` por producto.
  - `rows[]`: versión “flat” global (una fila por costo) para tablas.
  - `totals`: suma global (`fixedCOP`, `variableCOP`, `totalCOP`).

### Inventario (`/inventory`)

- `POST /inventory` — crea ítem.

  Body:

```json
{
  "name": "Café molido",
  "categoryId": "cat_…",
  "quantity": 1000,
  "unit": "g",
  "unitCost": 81.5,
  "supplier": "Opcional",
  "lot": "Opcional",
  "minStock": 200
}
```

- `GET /inventory` — lista paginada.
  - **Query**: `page`, `limit`, `search`, `categoryId`.
- `GET /inventory/:id` — detalle.
- `PATCH /inventory/:id` — actualiza.

  Body (todos opcionales):

```json
{ "quantity": 800, "unitCost": 90 }
```

- `DELETE /inventory/:id` — archiva (`deletedAt`).

### Lotes de compra (`/purchase-lots`)

Los lotes son históricos y se enlazan por `inventory.lot` ↔ `purchase_lots.code`.

- `GET /purchase-lots` — lista paginada.
  - **Query**: `page`, `limit`, `search`, `dateFrom`, `dateTo`.
- `GET /purchase-lots/:id` — detalle.
- `PATCH /purchase-lots/:id` — actualiza (`purchaseDate`, `supplier`, `notes`, `totalValue`).

  Body (todos opcionales):

```json
{ "purchaseDate": "2026-04-06", "supplier": "Proveedor", "totalValue": 123000 }
```

### Ventas (`/sales`)

- `POST /sales` — crea venta con líneas.

  Body:

```json
{
  "saleDate": "2026-04-06T10:00:00.000Z",
  "paymentMethod": "efectivo",
  "source": "MANUAL",
  "mesa": "5",
  "notes": "Opcional",
  "userId": "usr_…",
  "lines": [
    {
      "productId": "prd_…",
      "productName": "Café negro artesanal",
      "quantity": 1,
      "unitPrice": 7000,
      "costAtSale": 1500,
      "profit": 5500
    }
  ]
}
```

- `GET /sales` — lista paginada.
  - **Query**: `page`, `limit`, `search`, `source`, `dateFrom`, `dateTo`.
  - **Respuesta** (`data[]`): `saleDate` (ISO), **`saleDateOnly`** (`YYYY-MM-DD`), `createdAt`, `updatedAt`, **`total`** (número COP, para tablas), **`totalCOP`** (string), `displayPerson` (nombre o `—`), `recordedByName` / `recordedByUserId`, **`lineCount`**, `paymentMethod`, `source`, `mesa`, `notes`, `userId`, `cartId`, `user`, `cart` (incluye `cart.user` si existe), `payments[]`, `paymentSummary`, `counts`.
- `GET /sales/:id` — detalle completo para el front.
  - Igual que el listado en cabecera (`total`, `totalCOP`, `saleDate`, `saleDateOnly`, `displayPerson`, …), más: **`lines`** con `unitPrice` / `lineTotal` (número), `lineSubtotalCOP`, costo/utilidad, producto ampliado, **`lineSummary`**, **`cart.items`** y **`cart.user`**, **`payments`** con `metadata`, **`stockMovements`**.
- `PATCH /sales/:id` — actualiza cabecera (fecha, método, mesa, notas, usuario, source).

  Body (todos opcionales):

```json
{ "notes": "Cerrado", "paymentMethod": "tarjeta" }
```

- `PUT /sales/:id/lines` — reemplaza todas las líneas y recalcula total.

  Body:

```json
{
  "lines": [
    { "productId": "prd_…", "productName": "Café", "quantity": 2, "unitPrice": 7000 }
  ]
}
```

### Explorador de tablas (`/explorer`) — “gestión” tipo DB browser (solo lectura)

- `GET /explorer/tables` — lista de tablas expuestas.
- `GET /explorer/tables/:slug?limit=50&offset=0` — filas + columnas (paginado, `limit` máx 500).

Tablas expuestas (slugs): `users`, `categories`, `products`, `inventory`, `purchase_lots`, `recipes`, `recipe_ingredients`, `costos`, `carts`, `cart_items`, `sales`, `sale_lines`, `payments`, `stock_movements`, `expenses`, `partners`, `partner_contributions`, `tasks`.

### Gastos administrativos base (`/admin-expenses`)

Tabla para guardar los **valores base** (mensuales) de: arriendo, agua, luz, internet, seguridad y salarios. Sirve para costeo/planeación; no reemplaza la tabla `expenses` (gastos transaccionales).

- `GET /admin-expenses` — lista todos los valores base.
- `PUT /admin-expenses` — upsert por `kind` (único).

Body:

```json
{ "kind": "ARRIENDO", "name": "Arriendo local", "period": "MONTHLY", "amountCOP": 3500000, "active": true }
```

- `DELETE /admin-expenses/:kind` — elimina el registro (por `kind`).

### Gastos base (`/gastos`)

Tabla `gastos` para planeación/tablero (fijos vs variables).

- `GET /gastos` — devuelve:
  - `fixed[]` (mensuales) y `variable[]` (operativos)
  - `items[]` (flat, todos los gastos)
  - `fixedByType[]` / `variableByType[]` para render por secciones
  - `totals` (`fixedCOP`, `variableCOP`, `totalCOP`)
- `PUT /gastos` — upsert por `(kind,type)` (único).

Body:

```json
{ "kind": "FIJO", "type": "ARRIENDO", "name": "Arriendo", "period": "MONTHLY", "amountCOP": 3500000, "active": true }
```

- `DELETE /gastos?kind=FIJO&type=ARRIENDO` — borra un gasto por su clave compuesta.

## Base de datos

### Migraciones

```bash
npm run db:migrate      # prisma migrate deploy (CI / prod)
npm run db:migrate:dev  # crear/aplicar migración en desarrollo
```

Incluye la tabla `purchase_lots` (lotes de compra históricos enlazados por `inventory.lot`) y la tabla **`costos`** (`RecipeCost`): costeo de receta con **`FIJO`** vs **`VARIABLE`**, sin crear filas en `inventory`.

- **`recipe_ingredients`**: solo enlaces a inventario físico (descuenta stock al vender).
- **`costos`**: líneas de la hoja de costos (materiales sin stock, indirectos, etc.).

Tras desplegar la migración de `costos`, si ya tenías recetas sembradas con inventario “Recetas (costeo)” o lotes `seed:receta:…`, ejecuta una vez:

```bash
npm run db:migrate-recipe-costs-to-costos
```

Luego puedes volver a sembrar menú con `npm run db:seed-menu-recipes`. El detalle de producto expone `recipe.costs` e `recipe.ingredients` (ya no un único `recipe.lines`).

### Verificar consistencia de datos locales

Comprueba que `inventory.json`, `inventory-purchase-lots.tsv` y los `productId` de ingredientes en `recipes.json` estén alineados:

```bash
npm run db:verify-data
```

Última verificación esperada: **222** ítems de inventario, **30** lotes distintos, **222** líneas en el TSV con los mismos `item_id`, y recetas sin referencias rotas.

### Inventario, socios y lotes

Los ítems viven en `prisma/data/tables/inventory.json` (ids estables `inv-…`). El export tabular de lotes se regenera desde ese JSON:

| Comando | Descripción |
| --------|-------------|
| `npm run db:export-inventory-lots-tsv` | Escribe `prisma/data/inventory-purchase-lots.tsv` |
| `npm run db:import-inventory-partners` | Upsert de `inventory` + `PartnerContribution` (INSUMO) inferido por socio |
| `npm run db:register-purchase-lots` | Upsert de `purchase_lots` (agregados por código de lote) |
| `npm run db:backfill-purchase-lot-dates-from-code` | Ajusta `purchase_lots.purchase_date` infiriéndola del código de lote. Si la tabla está vacía, usa `--from-inventory` para crear/actualizar lotes desde `inventory.lot`. `--dry-run` solo lista cambios |

Orden sugerido en una base nueva (tras migraciones y categorías necesarias):

1. `npm run db:import-inventory-partners`
2. `npm run db:register-purchase-lots`

Opciones útiles: `--dry-run` en ambos scripts; el de socios acepta `--skip-delete-contributions` para no borrar aportes marcados con el prefijo de importación.

### Otros scripts de datos

| Comando | Descripción |
| --------|-------------|
| `npm run db:import-organized` | Import desde `prisma/data/organized-dump.json` (asigna ids nuevos; no preserva `inv-…` del JSON de inventario) |
| `npm run db:sync-products` | Productos desde `prisma/data/lista-productos.csv` |
| `npm run db:import-sales-json` | Ventas desde JSON |
| `npm run db:backfill-sale-lines` | Rellena costos en líneas de venta |
| `npm run db:purge-soft-deleted` | Elimina físicamente productos soft-deleted |
| `npm run db:seed-menu-recipes` | Siembra recetas de menú (cafetería, bar, comida) |

Exploración: `npm run db:studio`.

## Estructura relevante

- `prisma/schema.prisma` — modelos (`Inventory`, `RecipeCost` → tabla `costos`, `PurchaseLot`, …)
- `prisma/data/tables/` — tablas en JSON para dumps / import
- `scripts/` — importadores y utilidades de datos

## Documentación NestJS

Plantilla original del framework: [documentación NestJS](https://docs.nestjs.com).

## Licencia

UNLICENSED (privado).
