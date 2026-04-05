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
