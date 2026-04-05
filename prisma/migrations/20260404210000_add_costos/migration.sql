-- CreateEnum
CREATE TYPE "RecipeCostKind" AS ENUM ('FIJO', 'VARIABLE');

-- CreateTable
CREATE TABLE "costos" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "kind" "RecipeCostKind" NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,4),
    "unit" TEXT NOT NULL,
    "line_total_cop" DECIMAL(12,2) NOT NULL,
    "sheet_unit_cost" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "costos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_costos_recipe_id" ON "costos"("recipe_id");

-- AddForeignKey
ALTER TABLE "costos" ADD CONSTRAINT "costos_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
