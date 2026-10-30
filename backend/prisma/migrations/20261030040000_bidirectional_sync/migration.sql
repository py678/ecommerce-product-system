BEGIN;

CREATE TABLE "_sync_identity" (
  "id" INTEGER NOT NULL DEFAULT 1 PRIMARY KEY CHECK (id = 1),
  "node_id" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE
);
INSERT INTO "_sync_identity" (id) VALUES (1);

CREATE TABLE "_sync_versions" (
  "table_name" VARCHAR(16) NOT NULL CHECK (table_name IN ('users', 'categories', 'products')),
  "record_id" UUID NOT NULL,
  "changed_at" TIMESTAMPTZ(6) NOT NULL,
  "origin_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  CONSTRAINT "_sync_versions_pkey" PRIMARY KEY (table_name, record_id)
);
CREATE TABLE "_sync_events" (
  "sequence" BIGSERIAL PRIMARY KEY,
  "event_id" UUID NOT NULL UNIQUE,
  "table_name" VARCHAR(16) NOT NULL CHECK (table_name IN ('users', 'categories', 'products')),
  "record_id" UUID NOT NULL,
  "operation" VARCHAR(6) NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
  "row_data" JSONB,
  "changed_at" TIMESTAMPTZ(6) NOT NULL,
  "origin_id" UUID NOT NULL,
  "delivered_at" TIMESTAMPTZ(6),
  "attempted_at" TIMESTAMPTZ(6),
  "last_error" VARCHAR(32)
);
CREATE INDEX "_sync_events_delivered_at_attempted_at_sequence_idx"
  ON "_sync_events" (delivered_at, attempted_at, sequence);

-- These functions run with the table owner's normal permissions (no SECURITY DEFINER).
CREATE FUNCTION capture_sync_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  body JSONB;
  record UUID;
  origin UUID;
  event UUID := gen_random_uuid();
  changed TIMESTAMPTZ(6);
BEGIN
  IF current_setting('silk.sync_apply', true) = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'DELETE' THEN body := to_jsonb(OLD); ELSE body := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Changing a synchronized primary key is not supported';
  END IF;
  record := (body->>'id')::uuid;
  SELECT node_id INTO STRICT origin FROM _sync_identity WHERE id = 1;
  SELECT greatest(clock_timestamp(), changed_at + interval '1 microsecond')
    INTO changed FROM _sync_versions WHERE table_name = TG_TABLE_NAME AND record_id = record;
  changed := coalesce(changed, clock_timestamp());
  INSERT INTO _sync_versions (table_name, record_id, changed_at, origin_id, event_id)
    VALUES (TG_TABLE_NAME, record, changed, origin, event)
    ON CONFLICT (table_name, record_id) DO UPDATE SET
      changed_at = EXCLUDED.changed_at, origin_id = EXCLUDED.origin_id, event_id = EXCLUDED.event_id;
  INSERT INTO _sync_events (event_id, table_name, record_id, operation, row_data, changed_at, origin_id)
    VALUES (event, TG_TABLE_NAME, record, CASE WHEN TG_OP = 'DELETE' THEN 'DELETE' ELSE 'UPSERT' END,
            CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE body END, changed, origin);
  RETURN NULL;
END;
$$;

CREATE FUNCTION reject_sync_truncate() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE bypasses row synchronization; use DELETE instead';
END;
$$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['users', 'categories', 'products'] LOOP
    EXECUTE format('CREATE TRIGGER capture_sync_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_sync_change()', tbl);
    EXECUTE format('CREATE TRIGGER reject_sync_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION reject_sync_truncate()', tbl);
    -- Existing rows are bootstrapped in dependency order, preserving their original modification times.
    EXECUTE format('INSERT INTO _sync_events (event_id, table_name, record_id, operation, row_data, changed_at, origin_id)
      SELECT gen_random_uuid(), %L, r.id, ''UPSERT'', to_jsonb(r), r.updated_at, n.node_id
      FROM %I r CROSS JOIN _sync_identity n', tbl, tbl);
  END LOOP;
END;
$$;
INSERT INTO _sync_versions (table_name, record_id, changed_at, origin_id, event_id)
  SELECT table_name, record_id, changed_at, origin_id, event_id FROM _sync_events;

COMMIT;
