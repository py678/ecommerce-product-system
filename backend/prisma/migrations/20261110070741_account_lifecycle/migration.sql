BEGIN;
-- Additive migration: no users or business records are removed.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "delete_reason" VARCHAR(500),
ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "deleted_by" UUID;

-- CreateTable
CREATE TABLE "account_audits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "actor_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tombstones" (
    "id" UUID NOT NULL,
    "purged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_audits_target_id_created_at_idx" ON "account_audits"("target_id", "created_at");

-- CreateIndex
CREATE INDEX "users_deleted_at_created_at_idx" ON "users"("deleted_at", "created_at");

INSERT INTO permissions(code,name,module,scoped) VALUES
 ('user:delete','软删除账号','账号',false),
 ('user:restore','恢复账号','账号',false),
 ('user:purge','彻底删除账号（仅系统管理员）','账号',false);
-- Deterministic grant IDs make independently upgraded peers identical.
-- Seeds are deployed on BOTH peers; suppress guards/events only within this migration transaction.
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_write_guard;
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_capture;
INSERT INTO role_permissions(id,role_id,permission_code,scope)
 SELECT md5('00000000-0000-4000-8000-000000000010:' || code)::uuid,
 '00000000-0000-4000-8000-000000000010'::uuid,code,'ALL'::"DataScope"
 FROM permissions WHERE code IN ('user:delete','user:restore','user:purge');
ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_capture;
ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_write_guard;

ALTER TABLE _sync_events DROP CONSTRAINT _sync_events_table_name_check;
ALTER TABLE _sync_versions DROP CONSTRAINT _sync_versions_table_name_check;
ALTER TABLE _sync_events ADD CONSTRAINT _sync_events_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions','user_tombstones'));
-- user_lifecycle is a version-only namespace, tracking PRIMARY state independently of peer profile clocks.
ALTER TABLE _sync_versions ADD CONSTRAINT _sync_versions_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions','user_tombstones','user_lifecycle'));
CREATE TRIGGER tombstone_capture AFTER INSERT ON user_tombstones FOR EACH ROW EXECUTE FUNCTION capture_sync_change();
CREATE TRIGGER tombstone_write_guard BEFORE INSERT OR UPDATE OR DELETE ON user_tombstones FOR EACH ROW EXECUTE FUNCTION guard_commerce_write();
CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON user_tombstones FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate();
-- Tombstones are permanent, even after the name/email has been reused by a new UUID.
CREATE FUNCTION immutable_user_tombstone() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ACCOUNT_TOMBSTONE_IMMUTABLE' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER tombstone_immutable BEFORE UPDATE OR DELETE ON user_tombstones FOR EACH ROW EXECUTE FUNCTION immutable_user_tombstone();

CREATE FUNCTION guard_user_lifecycle() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mode text; replay boolean;
BEGIN
 SELECT write_role INTO STRICT mode FROM _commerce_config WHERE id=1;
 replay := coalesce(current_setting('silk.sync_apply',true),'')='on';
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM user_tombstones WHERE id=NEW.id) THEN
   RAISE EXCEPTION 'ACCOUNT_UUID_PURGED' USING ERRCODE='55000';
 END IF;
 IF mode='REPLICA' AND NOT replay THEN
   IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ACCOUNT_REPLICA_READ_ONLY' USING ERRCODE='55000'; END IF;
   IF TG_OP='INSERT' THEN
     IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL OR NEW.delete_reason IS NOT NULL THEN
       RAISE EXCEPTION 'ACCOUNT_REPLICA_READ_ONLY' USING ERRCODE='55000'; END IF;
   ELSIF (NEW.deleted_at,NEW.deleted_by,NEW.delete_reason) IS DISTINCT FROM (OLD.deleted_at,OLD.deleted_by,OLD.delete_reason) THEN
     RAISE EXCEPTION 'ACCOUNT_REPLICA_READ_ONLY' USING ERRCODE='55000';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
CREATE TRIGGER account_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION guard_user_lifecycle();
COMMIT;
