-- CreateTable
CREATE TABLE "purchase_lots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purchase_date" TIMESTAMPTZ(6) NOT NULL,
    "supplier" TEXT,
    "notes" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "total_value" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_lots_code_key" ON "purchase_lots"("code");

-- CreateIndex
CREATE INDEX "idx_purchase_lots_purchase_date" ON "purchase_lots"("purchase_date");
