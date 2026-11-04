-- Preserve immutable historical audit values before replacing the live role enum.
-- Existing retired-role accounts become operators and their previous sessions are revoked.
BEGIN;
ALTER TABLE "role_audits"
  ALTER COLUMN "from_role" TYPE VARCHAR(16) USING ("from_role"::text),
  ALTER COLUMN "to_role" TYPE VARCHAR(16) USING ("to_role"::text);
UPDATE "users"
SET "role" = 'OPERATOR', "token_version" = "token_version" + 1,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "role"::text = 'VIEWER';
CREATE TYPE "UserRole_new" AS ENUM ('OPERATOR', 'ADMIN');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new"
  USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'OPERATOR';
COMMIT;
