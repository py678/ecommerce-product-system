-- Generated with migrate dev --create-only on isolated schemas; additive, no business data removed.
BEGIN;
-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('BASELINE', 'INITIAL', 'ADJUSTMENT', 'ORDER_DEDUCT', 'ORDER_CANCEL');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "owner_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "before_stock" INTEGER NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "after_stock" INTEGER NOT NULL,
    "stock_version" INTEGER NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR(64),
    "order_id" UUID,
    "order_no" VARCHAR(40),
    "reason" VARCHAR(500) NOT NULL,
    "operation_key" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_operation_key_key" ON "stock_movements"("operation_key");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_owner_id_created_at_idx" ON "stock_movements"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_created_at_idx" ON "stock_movements"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_type_created_at_idx" ON "stock_movements"("type", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_created_at_id_idx" ON "stock_movements"("created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_product_id_stock_version_key" ON "stock_movements"("product_id", "stock_version");

ALTER TABLE stock_movements
 ADD CONSTRAINT stock_movements_stock_check CHECK(before_stock>=0 AND after_stock>=0 AND stock_version>=0),
 ADD CONSTRAINT stock_movements_balance_check CHECK(before_stock::bigint+quantity_change::bigint=after_stock::bigint),
 ADD CONSTRAINT stock_movements_reason_check CHECK(length(btrim(reason))>0),
 ADD CONSTRAINT stock_movements_type_check CHECK(
   (type IN ('BASELINE','INITIAL') AND before_stock=0 AND quantity_change>=0 AND order_id IS NULL AND order_no IS NULL) OR
   (type='ADJUSTMENT' AND quantity_change<>0 AND actor_id IS NOT NULL AND order_id IS NULL AND order_no IS NULL) OR
   (type='ORDER_DEDUCT' AND quantity_change<0 AND actor_id IS NOT NULL AND order_id IS NOT NULL AND order_no IS NOT NULL) OR
   (type='ORDER_CANCEL' AND quantity_change>0 AND actor_id IS NOT NULL AND order_id IS NOT NULL AND order_no IS NOT NULL)
 );

INSERT INTO permissions(code,name,module,scoped) VALUES ('stock:read','查看库存流水','库存',true);
-- Deterministic grant IDs on both peers, preserving every custom role's existing grants.
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_write_guard;
ALTER TABLE role_permissions DISABLE TRIGGER role_permissions_capture;
INSERT INTO role_permissions(id,role_id,permission_code,scope)
 SELECT md5(r.id::text || ':stock:read')::uuid,r.id,'stock:read',
 CASE WHEN r.code='ADMIN' THEN 'ALL'::"DataScope" ELSE 'OWN'::"DataScope" END
 FROM roles r WHERE r.system AND r.code IN ('ADMIN','OPERATOR');
ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_capture;
ALTER TABLE role_permissions ENABLE TRIGGER role_permissions_write_guard;
UPDATE users SET token_version=token_version+1
 WHERE role_id IN (SELECT id FROM roles WHERE system AND code IN ('ADMIN','OPERATOR'));

ALTER TABLE _sync_events DROP CONSTRAINT _sync_events_table_name_check;
ALTER TABLE _sync_versions DROP CONSTRAINT _sync_versions_table_name_check;
ALTER TABLE _sync_events ADD CONSTRAINT _sync_events_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions','user_tombstones','stock_movements'));
ALTER TABLE _sync_versions ADD CONSTRAINT _sync_versions_table_name_check CHECK(table_name IN ('users','categories','products','orders','order_items','order_logs','roles','role_permissions','user_tombstones','user_lifecycle','stock_movements'));
CREATE TRIGGER commerce_write_guard BEFORE INSERT OR UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION guard_commerce_write();
CREATE TRIGGER capture_sync_change AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION capture_sync_change();
CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON stock_movements FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate();
CREATE FUNCTION immutable_stock_movement() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'STOCK_MOVEMENT_IMMUTABLE' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER stock_movement_immutable BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION immutable_stock_movement();
-- Only the authoritative side creates baseline IDs; the REPLICA receives the exact rows through replication.
INSERT INTO stock_movements(product_id,product_name,owner_id,type,before_stock,quantity_change,after_stock,stock_version,reason,operation_key)
 SELECT p.id,p.name,p.user_id,'BASELINE',0,p.stock,p.stock,p.stock_version,
 '库存流水启用时的期初结存，不代表历史采购入库','baseline:' || p.id::text
 FROM products p WHERE (SELECT write_role FROM _commerce_config WHERE id=1)<>'REPLICA'
 ON CONFLICT DO NOTHING;
COMMIT;
