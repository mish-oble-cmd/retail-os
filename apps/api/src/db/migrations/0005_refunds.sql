-- 0005_refunds — refund facts (1C, FR-1.8). Refunds reference an existing
-- order; restock reuses the stock_movements ledger (movement_type
-- 'refund_restock'), so this migration adds only the refund + refund_lines
-- fact tables. Order state transitions to refunded/partially_refunded are
-- server-set on the existing orders row (already granted UPDATE).

CREATE TABLE refunds (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  order_id text NOT NULL,
  staff_id text,
  approved_by text,
  currency text NOT NULL,
  total_amount bigint NOT NULL,
  tax_amount bigint NOT NULL DEFAULT 0,
  tax_lines jsonb NOT NULL DEFAULT '[]',
  tender_type text NOT NULL CHECK (tender_type IN ('cash','card_manual')),
  card_ref text,
  card_last4 text,
  client_created_at timestamptz,
  local_seq bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refunds_order_fk FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id),
  CONSTRAINT refunds_staff_fk FOREIGN KEY (store_id, staff_id) REFERENCES staff (store_id, id)
);
CREATE INDEX refunds_store_order_idx ON refunds (store_id, order_id);
CREATE UNIQUE INDEX refunds_register_seq_unique ON refunds (store_id, local_seq)
  WHERE local_seq IS NOT NULL;

-- refunds carries a composite unique so refund_lines can FK on (store_id, id)
ALTER TABLE refunds ADD CONSTRAINT refunds_store_id_unique UNIQUE (store_id, id);

-- order_line_id is a plain reference (order_lines has no composite unique — it
-- is append-only fact data); the ingest validates it belongs to the order.
CREATE TABLE refund_lines (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  refund_id text NOT NULL,
  order_line_id text NOT NULL,
  variant_id text,
  qty bigint NOT NULL,
  amount bigint NOT NULL,
  restock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_lines_refund_fk FOREIGN KEY (store_id, refund_id) REFERENCES refunds (store_id, id)
);
CREATE INDEX refund_lines_store_refund_idx ON refund_lines (store_id, refund_id);

-- ---- Row-level security ------------------------------------------------------

ALTER TABLE refunds      ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds      FORCE ROW LEVEL SECURITY;
ALTER TABLE refund_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON refunds
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON refund_lines
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---- Grants (append-only facts) ---------------------------------------------

GRANT SELECT, INSERT ON refunds TO retailos_app;
GRANT SELECT, INSERT ON refund_lines TO retailos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON refunds, refund_lines TO retailos_admin;
