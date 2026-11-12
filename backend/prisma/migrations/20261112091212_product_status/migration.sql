-- Generated with migrate dev --create-only on isolated development/shadow schemas.
-- Additive: existing products remain available and all business data is retained.
BEGIN;
-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('PUBLISHED', 'OFFLINE');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'PUBLISHED';

-- CreateIndex
CREATE INDEX "products_status_created_at_idx" ON "products"("status", "created_at");
COMMIT;
