-- Normalizar códigos de lote (FK exige coincidencia exacta con purchase_lots.code)
UPDATE "inventory" SET "lot" = btrim("lot") WHERE "lot" IS NOT NULL;
UPDATE "inventory" SET "lot" = NULL WHERE "lot" IS NOT NULL AND "lot" = '';

-- Compras mínimas para todo código de lote usado en inventario y aún sin fila en purchase_lots
INSERT INTO "purchase_lots" ("id", "code", "purchase_date", "supplier", "notes", "item_count", "total_value", "created_at", "updated_at")
SELECT
  'lotbk_' || md5("sub"."code"),
  "sub"."code",
  "sub"."first_seen",
  NULL,
  'auto: creado en migración para enlazar inventario (inventory.lot → purchase_lots.code)',
  0,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT
    btrim(i."lot") AS "code",
    MIN(i."created_at") AS "first_seen"
  FROM "inventory" i
  WHERE i."lot" IS NOT NULL
    AND btrim(i."lot") <> ''
  GROUP BY btrim(i."lot")
) AS "sub"
WHERE NOT EXISTS (
  SELECT 1 FROM "purchase_lots" p WHERE p."code" = "sub"."code"
);

-- Alinear conteos con inventario activo
UPDATE "purchase_lots" pl
SET "item_count" = (
  SELECT COUNT(*)::integer
  FROM "inventory" inv
  WHERE inv."deleted_at" IS NULL
    AND inv."lot" IS NOT NULL
    AND inv."lot" = pl."code"
);

-- FK: no borrar compra si sigue habiendo ítems que la referencian; si cambia code en purchase_lots, propaga a inventory.lot
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_lot_fkey"
  FOREIGN KEY ("lot") REFERENCES "purchase_lots"("code")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
