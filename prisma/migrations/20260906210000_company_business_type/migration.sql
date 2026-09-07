-- AlterTable
ALTER TABLE "companies" ADD COLUMN "business_type" TEXT;

-- Empresas que ya operan: no forzar el formulario de onboarding.
UPDATE "companies" AS c
SET "business_type" = 'legacy'
WHERE c."business_type" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "company_modules" cm
    WHERE cm."company_id" = c."id"
      AND cm."is_enabled" = true
  );
