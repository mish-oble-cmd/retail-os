-- Phase 1 / workstream 1A: settings (tax), catalog, inventory ledger.
-- Same tenancy discipline as 0000: RLS enabled AND forced on every table,
-- policies keyed to app.store_id, app role has no BYPASSRLS.
--
-- Two mechanisms introduced here (both recorded in data-model.md):
--
-- sync_rev: server-assigned monotonic revision per store on every ⬇-synced
-- table (drives the 1B delta feed). A BEFORE INSERT/UPDATE trigger bumps
-- stores.sync_seq and stamps the row — app code cannot forget it; concurrent
-- writers serialize on the store row (fine at Phase 1 volume).
--
-- Composite intra-tenant FKs: Postgres RI checks BYPASS row-level security,
-- so `variant_id REFERENCES variants(id)` would let tenant B reference
-- tenant A's variant. Every intra-tenant FK is therefore
-- (store_id, <id>) REFERENCES parent(store_id, id).

ALTER TABLE stores ADD COLUMN sync_seq bigint NOT NULL DEFAULT 0;

-- Parents referenced by Phase 1 children need UNIQUE (store_id, id).
ALTER TABLE locations ADD CONSTRAINT locations_store_id_unique UNIQUE (store_id, id);
ALTER TABLE staff     ADD CONSTRAINT staff_store_id_unique     UNIQUE (store_id, id);

CREATE FUNCTION bump_sync_rev() RETURNS trigger AS $$
BEGIN
  UPDATE stores SET sync_seq = sync_seq + 1 WHERE id = NEW.store_id
    RETURNING sync_seq INTO NEW.sync_rev;
  IF NEW.sync_rev IS NULL THEN
    RAISE EXCEPTION 'bump_sync_rev: store % not visible in this context', NEW.store_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---- Settings: tax --------------------------------------------------------

CREATE TABLE tax_categories (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_categories_store_id_unique UNIQUE (store_id, id)
);

CREATE TABLE tax_rates (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  tax_category_id text NOT NULL,
  name text NOT NULL,
  -- integer basis points (9% GST = 900); tax math is integer-only (data-model.md §Tax)
  rate_bp integer NOT NULL CHECK (rate_bp >= 0 AND rate_bp <= 10000),
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_category_fk FOREIGN KEY (store_id, tax_category_id)
    REFERENCES tax_categories (store_id, id)
);
CREATE INDEX tax_rates_store_category_idx ON tax_rates (store_id, tax_category_id);

-- ---- Catalog ---------------------------------------------------------------

CREATE TABLE categories (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  parent_id text,
  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT categories_parent_fk FOREIGN KEY (store_id, parent_id)
    REFERENCES categories (store_id, id)
);
CREATE INDEX categories_store_parent_idx ON categories (store_id, parent_id);

CREATE TABLE products (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  name text NOT NULL,
  description text,
  category_id text,
  brand text,
  images jsonb NOT NULL DEFAULT '[]',
  -- ordered option definitions, e.g. [{"name":"Size","values":["S","M","L"]}]
  options jsonb NOT NULL DEFAULT '[]',
  tax_category_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  has_variants boolean NOT NULL DEFAULT false,
  custom jsonb NOT NULL DEFAULT '{}',
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT products_category_fk FOREIGN KEY (store_id, category_id)
    REFERENCES categories (store_id, id),
  CONSTRAINT products_tax_category_fk FOREIGN KEY (store_id, tax_category_id)
    REFERENCES tax_categories (store_id, id)
);
CREATE INDEX products_store_status_idx ON products (store_id, status);

CREATE TABLE variants (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  product_id text NOT NULL,
  -- chosen combination keyed by option name, e.g. {"Size":"M","Color":"Black"}
  option_values jsonb NOT NULL DEFAULT '{}',
  sku text,
  price_amount bigint NOT NULL CHECK (price_amount >= 0),
  compare_at_amount bigint CHECK (compare_at_amount >= 0),
  cost_amount bigint CHECK (cost_amount >= 0),
  track_stock boolean NOT NULL DEFAULT true,
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variants_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT variants_product_fk FOREIGN KEY (store_id, product_id)
    REFERENCES products (store_id, id)
);
CREATE INDEX variants_store_product_idx ON variants (store_id, product_id);

CREATE TABLE barcodes (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  variant_id text NOT NULL,
  code text NOT NULL,
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT barcodes_variant_fk FOREIGN KEY (store_id, variant_id)
    REFERENCES variants (store_id, id)
);
CREATE UNIQUE INDEX barcodes_store_code_unique ON barcodes (store_id, code);
CREATE INDEX barcodes_store_variant_idx ON barcodes (store_id, variant_id);

-- ---- Inventory: immutable ledger + projection ------------------------------

CREATE TABLE inventory_levels (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  variant_id text NOT NULL,
  location_id text NOT NULL,
  on_hand bigint NOT NULL DEFAULT 0,
  reorder_point bigint,
  reorder_qty bigint,
  sync_rev bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_levels_variant_fk FOREIGN KEY (store_id, variant_id)
    REFERENCES variants (store_id, id),
  CONSTRAINT inventory_levels_location_fk FOREIGN KEY (store_id, location_id)
    REFERENCES locations (store_id, id)
);
CREATE UNIQUE INDEX inventory_levels_store_variant_location_unique
  ON inventory_levels (store_id, variant_id, location_id);

CREATE TABLE stock_movements (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  variant_id text NOT NULL,
  location_id text NOT NULL,
  qty_delta bigint NOT NULL,
  movement_type text NOT NULL CHECK (movement_type IN
    ('sale', 'refund_restock', 'adjustment', 'receive', 'transfer_out', 'transfer_in', 'count')),
  reason text,
  ref_type text,
  ref_id text,
  staff_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_variant_fk FOREIGN KEY (store_id, variant_id)
    REFERENCES variants (store_id, id),
  CONSTRAINT stock_movements_location_fk FOREIGN KEY (store_id, location_id)
    REFERENCES locations (store_id, id),
  CONSTRAINT stock_movements_staff_fk FOREIGN KEY (store_id, staff_id)
    REFERENCES staff (store_id, id)
);
CREATE INDEX stock_movements_store_variant_location_idx
  ON stock_movements (store_id, variant_id, location_id, created_at);

-- ---- sync_rev triggers (⬇-synced tables only; movements are ⬆ facts) -------

CREATE TRIGGER tax_categories_sync_rev BEFORE INSERT OR UPDATE ON tax_categories
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER tax_rates_sync_rev BEFORE INSERT OR UPDATE ON tax_rates
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER categories_sync_rev BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER products_sync_rev BEFORE INSERT OR UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER variants_sync_rev BEFORE INSERT OR UPDATE ON variants
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER barcodes_sync_rev BEFORE INSERT OR UPDATE ON barcodes
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER inventory_levels_sync_rev BEFORE INSERT OR UPDATE ON inventory_levels
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();

-- Delta-feed index: the 1B puller reads "everything for this store above rev N".
CREATE INDEX tax_categories_store_rev_idx ON tax_categories (store_id, sync_rev);
CREATE INDEX tax_rates_store_rev_idx ON tax_rates (store_id, sync_rev);
CREATE INDEX categories_store_rev_idx ON categories (store_id, sync_rev);
CREATE INDEX products_store_rev_idx ON products (store_id, sync_rev);
CREATE INDEX variants_store_rev_idx ON variants (store_id, sync_rev);
CREATE INDEX barcodes_store_rev_idx ON barcodes (store_id, sync_rev);
CREATE INDEX inventory_levels_store_rev_idx ON inventory_levels (store_id, sync_rev);

-- ---- Row-level security ----------------------------------------------------

ALTER TABLE tax_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE barcodes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  ENABLE ROW LEVEL SECURITY;

ALTER TABLE tax_categories   FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_rates        FORCE ROW LEVEL SECURITY;
ALTER TABLE categories       FORCE ROW LEVEL SECURITY;
ALTER TABLE products         FORCE ROW LEVEL SECURITY;
ALTER TABLE variants         FORCE ROW LEVEL SECURITY;
ALTER TABLE barcodes         FORCE ROW LEVEL SECURITY;
ALTER TABLE inventory_levels FORCE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON tax_categories
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON tax_rates
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON categories
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON products
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON variants
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON barcodes
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON inventory_levels
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON stock_movements
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---- Grants ----------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE
  ON tax_categories, tax_rates, categories, products, variants, barcodes
  TO retailos_app;
-- Projection: rebuildable from the ledger, so full CRUD is safe (rows go away
-- with their variant when it is deleted before any movement history exists).
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_levels TO retailos_app;
-- Ledger immutability (invariant #4): the app role cannot UPDATE or DELETE
-- movements — corrections are new rows. Only the BYPASSRLS admin role could.
GRANT SELECT, INSERT ON stock_movements TO retailos_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON tax_categories, tax_rates, categories, products, variants, barcodes,
     inventory_levels, stock_movements
  TO retailos_admin;
