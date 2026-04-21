-- Líneas de comprobante de compra (costo histórico). No se recalculan al consumir stock.

CREATE TABLE "purchase_lot_lines" (
    "id" TEXT NOT NULL,
    "purchase_lot_code" TEXT NOT NULL,
    "inventory_item_id" TEXT,
    "line_name" TEXT NOT NULL,
    "category_id" TEXT,
    "quantity_purchased" DECIMAL(12,4) NOT NULL,
    "unit" TEXT NOT NULL,
    "purchase_unit_cost_cop" DECIMAL(12,2) NOT NULL,
    "line_total_cop" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lot_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_lot_lines_inventory_item_id_key"
    ON "purchase_lot_lines"("inventory_item_id");

CREATE INDEX "idx_purchase_lot_lines_lot_code" ON "purchase_lot_lines"("purchase_lot_code");

ALTER TABLE "purchase_lot_lines"
    ADD CONSTRAINT "purchase_lot_lines_purchase_lot_code_fkey"
    FOREIGN KEY ("purchase_lot_code") REFERENCES "purchase_lots"("code")
    ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "purchase_lot_lines"
    ADD CONSTRAINT "purchase_lot_lines_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_lot_lines"
    ADD CONSTRAINT "purchase_lot_lines_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
