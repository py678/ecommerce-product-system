-- Generated with prisma migrate dev --create-only in disposable databases.
-- This migration preserves legacy columns and all business records.
BEGIN;
SELECT set_config('silk.sync_apply', 'on', true);
-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('OWN', 'ALL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role_id" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000011';
ALTER TABLE role_audits ALTER COLUMN from_role TYPE VARCHAR(32), ALTER COLUMN to_role TYPE VARCHAR(32);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "module" VARCHAR(20) NOT NULL,
    "scoped" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "role_id" UUID NOT NULL,
    "permission_code" VARCHAR(40) NOT NULL,
    "scope" "DataScope" NOT NULL DEFAULT 'OWN',

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permission_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_role_id_permission_code_key" ON "role_permissions"("role_id", "permission_code");

-- CreateIndex
CREATE INDEX "permission_audits_role_id_created_at_idx" ON "permission_audits"("role_id", "created_at");

-- CreateIndex
CREATE INDEX "users_role_id_idx" ON "users"("role_id");

-- Stable IDs and timestamps make independently upgraded peers identical.
INSERT INTO roles(id,code,name,system,created_at,updated_at) VALUES
 ('00000000-0000-4000-8000-000000000010','ADMIN','管理员',true,'2026-11-10T00:00:00Z','2026-11-10T00:00:00Z'),
 ('00000000-0000-4000-8000-000000000011','OPERATOR','运营人员',true,'2026-11-10T00:00:00Z','2026-11-10T00:00:00Z');
INSERT INTO permissions(code,name,module,scoped) VALUES
 ('product:read','查看商品','商品',true),('product:create','创建商品','商品',false),
 ('product:update','修改商品','商品',true),('product:delete','删除商品','商品',true),
 ('category:read','查看分类','分类',false),('category:create','创建分类','分类',false),
 ('category:update','修改分类','分类',false),('category:delete','删除分类','分类',false),
 ('order:read','查看订单','订单',true),('order:create','创建订单','订单',false),
 ('order:confirm','确认订单','订单',true),('order:ship','发货','订单',true),
 ('order:complete','完成订单','订单',true),('order:cancel','取消订单','订单',true),
 ('upload:image','上传图片','图片',false),('user:read','查看账号','账号',false),
 ('user:assign-role','分配账号角色','账号',false),
 ('role:read','查看角色和审计','角色',false),('role:create','创建角色','角色',false),
 ('role:update','配置角色权限和状态','角色',false),('role:delete','删除空角色','角色',false);
INSERT INTO role_permissions(id,role_id,permission_code,scope)
 SELECT md5(r.id::text || ':' || p.code)::uuid,r.id,p.code,
 CASE WHEN r.code='ADMIN' OR NOT p.scoped OR p.code='product:read' THEN 'ALL'::"DataScope" ELSE 'OWN'::"DataScope" END
 FROM roles r CROSS JOIN permissions p
 WHERE r.code='ADMIN' OR p.code NOT LIKE 'role:%' AND p.code NOT LIKE 'user:%' AND p.code NOT IN ('category:create','category:update','category:delete');
UPDATE users SET role_id=CASE WHEN role='ADMIN' THEN '00000000-0000-4000-8000-000000000010'::uuid ELSE '00000000-0000-4000-8000-000000000011'::uuid END,
 token_version=token_version+1;
ALTER TABLE roles ADD CONSTRAINT roles_name_nonblank CHECK(length(btrim(name))>0),
 ADD CONSTRAINT roles_code_format CHECK(code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
 ADD CONSTRAINT roles_version_nonnegative CHECK(version>=0);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permissions"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep older registration/test/sync payloads compatible; authorization uses role_id.
CREATE FUNCTION normalize_user_role() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mode text; replay boolean; role_code text;
BEGIN
 SELECT write_role INTO STRICT mode FROM _commerce_config WHERE id=1;
 replay := coalesce(current_setting('silk.sync_apply',true),'')='on';
 IF TG_OP='INSERT' AND NEW.role='ADMIN' AND NEW.role_id='00000000-0000-4000-8000-000000000011' THEN
   NEW.role_id := '00000000-0000-4000-8000-000000000010';
 ELSIF TG_OP='UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.role_id=OLD.role_id THEN
   NEW.role_id := CASE WHEN NEW.role='ADMIN' THEN '00000000-0000-4000-8000-000000000010'::uuid ELSE '00000000-0000-4000-8000-000000000011'::uuid END;
 END IF;
 IF NOT replay AND mode='REPLICA' THEN
   IF TG_OP='UPDATE' THEN
     IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN RAISE EXCEPTION 'ROLE_REPLICA_READ_ONLY' USING ERRCODE='55000'; END IF;
   ELSIF NEW.role_id<>'00000000-0000-4000-8000-000000000011' THEN
     RAISE EXCEPTION 'ROLE_REPLICA_READ_ONLY' USING ERRCODE='55000';
   END IF;
 END IF;
 SELECT code INTO role_code FROM roles WHERE id=NEW.role_id;
 NEW.role := CASE WHEN role_code='ADMIN' THEN 'ADMIN'::"UserRole" ELSE 'OPERATOR'::"UserRole" END;
 RETURN NEW;
END; $$;
CREATE TRIGGER user_role_normalize BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION normalize_user_role();

ALTER TABLE _sync_events DROP CONSTRAINT _sync_events_table_name_check;
ALTER TABLE _sync_versions DROP CONSTRAINT _sync_versions_table_name_check;
ALTER TABLE _sync_events ADD CONSTRAINT _sync_events_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions'));
ALTER TABLE _sync_versions ADD CONSTRAINT _sync_versions_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions'));
CREATE TRIGGER roles_capture AFTER INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION capture_sync_change();
CREATE TRIGGER role_permissions_capture AFTER INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION capture_sync_change();
CREATE TRIGGER roles_write_guard BEFORE INSERT OR UPDATE OR DELETE ON roles FOR EACH ROW EXECUTE FUNCTION guard_commerce_write();
CREATE TRIGGER role_permissions_write_guard BEFORE INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION guard_commerce_write();
CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON roles FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate();
CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON role_permissions FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate();
COMMIT;
