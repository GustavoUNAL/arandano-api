-- Faster ILIKE/contains searches for frontend list views.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_name_trgm
  ON inventory USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_purchase_lots_code_trgm
  ON purchase_lots USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_purchase_lots_supplier_trgm
  ON purchase_lots USING gin (supplier gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_purchase_lots_notes_trgm
  ON purchase_lots USING gin (notes gin_trgm_ops);
