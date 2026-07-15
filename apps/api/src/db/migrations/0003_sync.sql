-- Phase 1 / workstream 1B: sync plumbing (docs: offline-sync-strategy.md,
-- data-model.md §Sync plumbing, plan docs/superpowers/plans/2026-07-11-1b-pos-data-layer.md).

-- ---- Phase-0 tables join the delta feed ------------------------------------

ALTER TABLE stores    ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE registers ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE staff     ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE roles     ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;

CREATE TRIGGER locations_sync_rev BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER registers_sync_rev BEFORE INSERT OR UPDATE ON registers
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER staff_sync_rev BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER roles_sync_rev BEFORE INSERT OR UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();

CREATE INDEX locations_store_rev_idx ON locations (store_id, sync_rev);
CREATE INDEX registers_store_rev_idx ON registers (store_id, sync_rev);
CREATE INDEX staff_store_rev_idx     ON staff (store_id, sync_rev);
CREATE INDEX roles_store_rev_idx     ON roles (store_id, sync_rev);

-- stores bumps itself in-row. pg_trigger_depth() guard: bump_sync_rev on the
-- OTHER tables performs `UPDATE stores SET sync_seq = …` (depth 1); without
-- the guard every catalog write would churn the store row into the delta feed.
CREATE FUNCTION bump_store_sync_rev() RETURNS trigger AS $$
BEGIN
  NEW.sync_seq := NEW.sync_seq + 1;
  NEW.sync_rev := NEW.sync_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stores_sync_rev BEFORE INSERT OR UPDATE ON stores
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION bump_store_sync_rev();

-- ---- Tombstones (deletions flow down the delta feed) ------------------------

CREATE TABLE sync_tombstones (
  store_id text NOT NULL REFERENCES stores(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  sync_rev bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, entity_type, entity_id)
);
CREATE INDEX sync_tombstones_store_rev_idx ON sync_tombstones (store_id, sync_rev);

CREATE TRIGGER sync_tombstones_sync_rev BEFORE INSERT OR UPDATE ON sync_tombstones
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();

CREATE FUNCTION write_sync_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstones (store_id, entity_type, entity_id)
  VALUES (OLD.store_id, TG_ARGV[0], OLD.id)
  ON CONFLICT (store_id, entity_type, entity_id)
    DO UPDATE SET deleted_at = now();
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_tombstone       AFTER DELETE ON categories       FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('category');
CREATE TRIGGER products_tombstone         AFTER DELETE ON products         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('product');
CREATE TRIGGER variants_tombstone         AFTER DELETE ON variants         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('variant');
CREATE TRIGGER barcodes_tombstone         AFTER DELETE ON barcodes         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('barcode');
CREATE TRIGGER tax_categories_tombstone   AFTER DELETE ON tax_categories   FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('tax_category');
CREATE TRIGGER tax_rates_tombstone        AFTER DELETE ON tax_rates        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('tax_rate');
CREATE TRIGGER inventory_levels_tombstone AFTER DELETE ON inventory_levels FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('inventory_level');
CREATE TRIGGER locations_tombstone        AFTER DELETE ON locations        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('location');
CREATE TRIGGER registers_tombstone        AFTER DELETE ON registers        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('register');
CREATE TRIGGER staff_tombstone            AFTER DELETE ON staff            FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('staff');
CREATE TRIGGER roles_tombstone            AFTER DELETE ON roles            FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('role');

-- ---- Devices (register trust; offline-sync-strategy.md §activation) ---------

-- An 8-char code must resolve a device unambiguously without a store id:
DROP INDEX IF EXISTS activation_codes_store_hash_unique;
CREATE UNIQUE INDEX activation_codes_code_hash_unique ON activation_codes (code_hash);

CREATE TABLE devices (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  token_hash text NOT NULL,
  app_version text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_register_fk FOREIGN KEY (store_id, register_id)
    REFERENCES registers (store_id, id)
);
CREATE UNIQUE INDEX devices_token_hash_unique ON devices (token_hash);
CREATE INDEX devices_store_register_idx ON devices (store_id, register_id);

-- ---- Order facts (data-model.md §Order; append-only, invariant 4) -----------

CREATE TABLE orders (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  location_id text NOT NULL,
  staff_id text,
  customer_id text,
  number text NOT NULL,
  state text NOT NULL CHECK (state IN ('completed','partially_paid','refunded','partially_refunded','voided')),
  currency text NOT NULL,
  subtotal_amount bigint NOT NULL,
  discount_amount bigint NOT NULL DEFAULT 0,
  tax_amount bigint NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL,
  tax_lines jsonb NOT NULL DEFAULT '[]',
  note text,
  source text NOT NULL DEFAULT 'pos' CHECK (source IN ('pos','api')),
  client_created_at timestamptz,
  local_seq bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT orders_register_fk FOREIGN KEY (store_id, register_id) REFERENCES registers (store_id, id),
  CONSTRAINT orders_location_fk FOREIGN KEY (store_id, location_id) REFERENCES locations (store_id, id),
  CONSTRAINT orders_staff_fk    FOREIGN KEY (store_id, staff_id)    REFERENCES staff (store_id, id)
);
CREATE INDEX orders_store_created_idx ON orders (store_id, client_created_at);
CREATE UNIQUE INDEX orders_register_seq_unique ON orders (store_id, register_id, local_seq)
  WHERE local_seq IS NOT NULL;

CREATE TABLE order_lines (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  order_id text NOT NULL,
  variant_id text,
  name text NOT NULL,
  qty bigint NOT NULL,
  unit_price_amount bigint NOT NULL,
  discounts jsonb NOT NULL DEFAULT '[]',
  tax_lines jsonb NOT NULL DEFAULT '[]',
  total_amount bigint NOT NULL,
  cost_snapshot_amount bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_lines_order_fk   FOREIGN KEY (store_id, order_id)   REFERENCES orders (store_id, id),
  CONSTRAINT order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES variants (store_id, id)
);
CREATE INDEX order_lines_store_order_idx ON order_lines (store_id, order_id);

CREATE TABLE payments (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  order_id text NOT NULL,
  tender_type text NOT NULL CHECK (tender_type IN ('cash','card_manual')),
  amount bigint NOT NULL,
  change_amount bigint NOT NULL DEFAULT 0,
  card_ref text,
  card_last4 text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_order_fk FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id)
);
CREATE INDEX payments_store_order_idx ON payments (store_id, order_id);

-- ---- Batch dedupe + conflicts ------------------------------------------------

CREATE TABLE sync_batches (
  id text NOT NULL,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  device_id text NOT NULL,
  fact_count integer NOT NULL,
  acks jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id),
  CONSTRAINT sync_batches_register_fk FOREIGN KEY (store_id, register_id) REFERENCES registers (store_id, id)
);

CREATE TABLE sync_conflicts (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  conflict_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CONSTRAINT sync_conflicts_staff_fk FOREIGN KEY (store_id, resolved_by) REFERENCES staff (store_id, id)
);
CREATE INDEX sync_conflicts_store_open_idx ON sync_conflicts (store_id, created_at) WHERE resolved_at IS NULL;

-- ---- Row-level security ------------------------------------------------------

ALTER TABLE sync_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts  ENABLE ROW LEVEL SECURITY;

ALTER TABLE sync_tombstones FORCE ROW LEVEL SECURITY;
ALTER TABLE devices         FORCE ROW LEVEL SECURITY;
ALTER TABLE orders          FORCE ROW LEVEL SECURITY;
ALTER TABLE order_lines     FORCE ROW LEVEL SECURITY;
ALTER TABLE payments        FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_batches    FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sync_tombstones
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON devices
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON orders
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON order_lines
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON payments
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON sync_batches
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON sync_conflicts
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---- Grants (append-only facts; orders may receive server-set state UPDATEs) --

GRANT SELECT, INSERT, UPDATE ON sync_tombstones TO retailos_app;  -- re-delete upserts
GRANT SELECT, INSERT, UPDATE ON devices TO retailos_app;          -- last_seen / revoke
GRANT SELECT, INSERT, UPDATE ON orders TO retailos_app;           -- state transitions only (invariant 4)
GRANT SELECT, INSERT ON order_lines TO retailos_app;
GRANT SELECT, INSERT ON payments TO retailos_app;
GRANT SELECT, INSERT ON sync_batches TO retailos_app;
GRANT SELECT, INSERT, UPDATE ON sync_conflicts TO retailos_app;   -- resolve = UPDATE
GRANT SELECT, INSERT, UPDATE, DELETE
  ON sync_tombstones, devices, orders, order_lines, payments, sync_batches, sync_conflicts
  TO retailos_admin;
