-- CreateEnum
CREATE TYPE "AdminExpenseKind" AS ENUM ('ARRIENDO', 'AGUA', 'LUZ', 'INTERNET', 'SEGURIDAD', 'SALARIOS');

-- CreateEnum
CREATE TYPE "AdminExpensePeriod" AS ENUM ('MONTHLY');

-- CreateTable
CREATE TABLE "admin_expenses" (
    "id" TEXT NOT NULL,
    "kind" "AdminExpenseKind" NOT NULL,
    "name" TEXT NOT NULL,
    "period" "AdminExpensePeriod" NOT NULL DEFAULT 'MONTHLY',
    "amount_cop" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_expenses_kind_key" ON "admin_expenses"("kind");

-- CreateIndex
CREATE INDEX "idx_admin_expenses_active" ON "admin_expenses"("active");
