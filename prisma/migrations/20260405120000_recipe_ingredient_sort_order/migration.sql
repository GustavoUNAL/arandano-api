-- Orden de la hoja de costos (insumos vs líneas de costeo).
ALTER TABLE "recipe_ingredients" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
