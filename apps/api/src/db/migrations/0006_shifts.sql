-- 0006_shifts — shift + cash-movement facts (1D, FR-6.1/6.2). A shift is the
-- cash-drawer lifecycle for one register: opened with a counted float, closed
-- with a blind count + over/short + a Z-report snapshot (stored verbatim as the
-- cashier saw it). Cash movements (paid in/out, no-sale) are individual facts.
-- Orders gain shift_id so the Z-report attributes exactly (stamped on-device).

CREATE TABLE shifts (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  location_id text NOT NULL,
  opened_by_staff_id text,
  opened_at timestamptz,
  opening_float bigint NOT NULL,
  closed_by_staff_id text,
  closed_at timestamptz,
  closing_counted bigint,
  closing_expected bigint,
  over_short bigint,
  z_snapshot jsonb,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','closed')),
  local_seq bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shifts_register_fk FOREIGN KEY (store_id, register_id) REFERENCES registers (store_id, id),
  CONSTRAINT shifts_opened_by_fk FOREIGN KEY (store_id, opened_by_staff_id) REFERENCES staff (store_id, id),
  CONSTRAINT shifts_store_id_unique UNIQUE (store_id, id)
);
CREATE INDEX shifts_store_register_idx ON shifts (store_id, register_id);

CREATE TABLE cash_movements (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  shift_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('paid_in','paid_out','no_sale')),
  amount bigint NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  staff_id text,
  approved_by_staff_id text,
  client_created_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cash_movements_shift_fk FOREIGN KEY (store_id, shift_id) REFERENCES shifts (store_id, id)
);
CREATE INDEX cash_movements_store_shift_idx ON cash_movements (store_id, shift_id);

-- orders gain the shift they were rung on (nullable — pre-1D orders have none).
ALTER TABLE orders ADD COLUMN shift_id text;

-- ---- Row-level security ------------------------------------------------------

ALTER TABLE shifts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts         FORCE ROW LEVEL SECURITY;
ALTER TABLE cash_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON shifts
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON cash_movements
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---- Grants ------------------------------------------------------------------
-- shifts need UPDATE (the close fact updates the open row); cash_movements are
-- append-only.

GRANT SELECT, INSERT, UPDATE ON shifts TO retailos_app;
GRANT SELECT, INSERT ON cash_movements TO retailos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON shifts, cash_movements TO retailos_admin;
