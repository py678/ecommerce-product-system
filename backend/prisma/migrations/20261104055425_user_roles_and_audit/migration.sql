-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('VIEWER', 'OPERATOR', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'VIEWER';

-- CreateTable
CREATE TABLE "role_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "from_role" "UserRole" NOT NULL,
    "to_role" "UserRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_audits_target_id_created_at_idx" ON "role_audits"("target_id", "created_at");
