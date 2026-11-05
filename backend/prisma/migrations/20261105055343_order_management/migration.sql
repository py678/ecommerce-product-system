BEGIN;
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SHIPPED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "_sync_events" ADD COLUMN     "transaction_id" VARCHAR(32) NOT NULL DEFAULT pg_current_xact_id()::text;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "stock_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "_commerce_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "write_role" VARCHAR(16) NOT NULL DEFAULT 'STANDALONE',

    CONSTRAINT "_commerce_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_no" VARCHAR(40) NOT NULL,
    "creator_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "customer_name" VARCHAR(80) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "address" VARCHAR(500) NOT NULL,
    "remark" VARCHAR(1000) NOT NULL DEFAULT '',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "total_amount" DECIMAL(18,2) NOT NULL,
    "carrier" VARCHAR(80),
    "tracking_no" VARCHAR(80),
    "confirmed_at" TIMESTAMPTZ(3),
    "shipped_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "cover_image" VARCHAR(2048),
    "unit_price" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" VARCHAR(64) NOT NULL,
    "action" VARCHAR(16) NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "reason" VARCHAR(500) NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_no_key" ON "orders"("order_no");

-- CreateIndex
CREATE INDEX "orders_creator_id_created_at_idx" ON "orders"("creator_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_creator_id_idempotency_key_key" ON "orders"("creator_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_product_id_key" ON "order_items"("order_id", "product_id");

-- CreateIndex
CREATE INDEX "order_logs_order_id_created_at_idx" ON "order_logs"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_logs" ADD CONSTRAINT "order_logs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Deployment role is configured separately after the existing sync queues are drained.
INSERT INTO "_commerce_config" (id) VALUES (1);
ALTER TABLE "_commerce_config" ADD CONSTRAINT commerce_config_singleton CHECK (id = 1),
  ADD CONSTRAINT commerce_config_role CHECK (write_role IN ('STANDALONE','PRIMARY','REPLICA'));
ALTER TABLE "products" ADD CONSTRAINT products_stock_version_nonnegative CHECK (stock_version >= 0);
ALTER TABLE "orders" ADD CONSTRAINT orders_total_nonnegative CHECK (total_amount >= 0),
  ADD CONSTRAINT orders_customer_nonblank CHECK (length(btrim(customer_name)) > 0 AND length(btrim(address)) > 0),
  ADD CONSTRAINT orders_shipping_fields CHECK (status NOT IN ('SHIPPED','COMPLETED') OR (carrier IS NOT NULL AND length(btrim(carrier)) > 0 AND tracking_no IS NOT NULL AND length(btrim(tracking_no)) > 0 AND shipped_at IS NOT NULL));
ALTER TABLE "order_items" ADD CONSTRAINT order_items_quantity_range CHECK (quantity BETWEEN 1 AND 9999),
  ADD CONSTRAINT order_items_money_consistent CHECK (unit_price >= 0 AND subtotal = unit_price * quantity);
ALTER TABLE "_sync_events" DROP CONSTRAINT "_sync_events_table_name_check";
ALTER TABLE "_sync_events" ADD CONSTRAINT "_sync_events_table_name_check" CHECK (table_name IN ('users','categories','products','orders','order_items','order_logs'));
ALTER TABLE "_sync_versions" DROP CONSTRAINT "_sync_versions_table_name_check";
ALTER TABLE "_sync_versions" ADD CONSTRAINT "_sync_versions_table_name_check" CHECK (table_name IN ('users','categories','products','orders','order_items','order_logs'));
CREATE INDEX _sync_events_transaction_id_idx ON _sync_events(transaction_id, sequence);

CREATE FUNCTION guard_commerce_write() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE mode TEXT; replay BOOLEAN;
BEGIN
  SELECT write_role INTO STRICT mode FROM _commerce_config WHERE id=1;
  replay := coalesce(current_setting('silk.sync_apply', true), '') = 'on';
  IF mode = 'REPLICA' AND NOT replay THEN
    RAISE EXCEPTION 'COMMERCE_REPLICA_READ_ONLY' USING ERRCODE = '55000';
  END IF;
  IF mode = 'PRIMARY' AND replay THEN
    RAISE EXCEPTION 'COMMERCE_PRIMARY_REJECTS_REPLICA' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE FUNCTION advance_stock_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('silk.sync_apply', true), '') <> 'on' AND NEW.stock IS DISTINCT FROM OLD.stock THEN
    NEW.stock_version := OLD.stock_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_version_guard BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION advance_stock_version();
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['products','orders','order_items','order_logs'] LOOP
    EXECUTE format('CREATE TRIGGER commerce_write_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_commerce_write()', tbl);
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['orders','order_items','order_logs'] LOOP
    EXECUTE format('CREATE TRIGGER capture_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_sync_change()', tbl);
    EXECUTE format('CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate()', tbl);
  END LOOP;
END;
$$;
COMMIT;
