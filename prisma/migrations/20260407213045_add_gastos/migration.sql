-- CreateEnum
CREATE TYPE "GastoKind" AS ENUM ('FIJO', 'VARIABLE');

-- CreateEnum
CREATE TYPE "GastoPeriod" AS ENUM ('MONTHLY');

-- CreateEnum
CREATE TYPE "GastoType" AS ENUM ('ARRIENDO', 'SALARIOS', 'AGUA', 'LUZ', 'GAS', 'INTERNET', 'PLATAFORMA', 'IMPUESTOS', 'SEGURIDAD', 'LIMPIEZA', 'TRANSPORTE', 'MANTENIMIENTO', 'COMISIONES', 'EMPAQUES');

-- CreateTable
CREATE TABLE "gastos" (
    "id" TEXT NOT NULL,
    "kind" "GastoKind" NOT NULL,
    "type" "GastoType" NOT NULL,
    "name" TEXT NOT NULL,
    "period" "GastoPeriod" NOT NULL DEFAULT 'MONTHLY',
    "amount_cop" DECIMAL(12,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gastos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_gastos_kind" ON "gastos"("kind");

-- CreateIndex
CREATE INDEX "idx_gastos_active" ON "gastos"("active");

-- CreateIndex
CREATE UNIQUE INDEX "gastos_kind_type_key" ON "gastos"("kind", "type");
