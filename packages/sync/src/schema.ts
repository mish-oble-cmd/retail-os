import type { SqlDriver } from './driver.js';

/**
 * Device SQLite schema (1B): mirror of the ⬇-synced server tables plus the
 * locally-produced fact tables and the outbox. Conventions: snake_case,
 * money as INTEGER minor units, JSON payloads as TEXT, booleans as 0/1.
 * POS-07/08 read local orders for 60 days (offline-sync-strategy.md).
 */
export const DEVICE_SCHEMA_VERSION = 3;

const DDL = `
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_id TEXT,
  register_id TEXT,
  location_id TEXT,
  device_token TEXT,
  last_ack_rev INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL
);

-- mirror (⬇ reference data — overwritten by bootstrap/deltas, never edited locally)
CREATE TABLE IF NOT EXISTS store (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  timezone TEXT NOT NULL,
  price_mode TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '{}',
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  pin_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS registers (
  id TEXT PRIMARY KEY,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  grid_layout TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tax_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  tax_category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rate_bp INTEGER NOT NULL,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  sync_rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT,
  brand TEXT,
  images TEXT NOT NULL DEFAULT '[]',
  options TEXT NOT NULL DEFAULT '[]',
  tax_category_id TEXT NOT NULL,
  status TEXT NOT NULL,
  has_variants INTEGER NOT NULL DEFAULT 0,
  custom TEXT NOT NULL DEFAULT '{}',
  sync_rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS products_status_idx ON products (status);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  option_values TEXT NOT NULL DEFAULT '{}',
  sku TEXT,
  price_amount INTEGER NOT NULL,
  compare_at_amount INTEGER,
  cost_amount INTEGER,
  track_stock INTEGER NOT NULL DEFAULT 1,
  sync_rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS variants_product_idx ON variants (product_id);
CREATE TABLE IF NOT EXISTS barcodes (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  sync_rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS barcodes_code_unique ON barcodes (code);
CREATE TABLE IF NOT EXISTS inventory_levels (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER,
  reorder_qty INTEGER,
  sync_rev INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_levels_variant_location
  ON inventory_levels (variant_id, location_id);

-- facts (⬆ produced locally — the local copy backs POS-07 lookup / POS-08 refunds)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  staff_id TEXT,
  shift_id TEXT,
  customer_id TEXT,
  state TEXT NOT NULL,
  currency TEXT NOT NULL,
  subtotal_amount INTEGER NOT NULL,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  tax_lines TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  client_created_at TEXT NOT NULL,
  local_seq INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_local_seq_unique ON orders (local_seq);
CREATE TABLE IF NOT EXISTS order_lines (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  variant_id TEXT,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price_amount INTEGER NOT NULL,
  discounts TEXT NOT NULL DEFAULT '[]',
  tax_lines TEXT NOT NULL DEFAULT '[]',
  total_amount INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS order_lines_order_idx ON order_lines (order_id);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  tender_type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  change_amount INTEGER NOT NULL DEFAULT 0,
  card_ref TEXT,
  card_last4 TEXT,
  captured_at TEXT
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments (order_id);
-- refunds (1C) — refund.completed facts. Restock lands in stock_movements as
-- movement_type refund_restock. refunded_qty per line is DERIVED from
-- refund_lines (single source of truth), so no ALTER of order_lines is needed.
CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  approved_by TEXT,
  currency TEXT NOT NULL,
  total_amount INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  tax_lines TEXT NOT NULL DEFAULT '[]',
  tender_type TEXT NOT NULL,
  card_ref TEXT,
  card_last4 TEXT,
  client_created_at TEXT NOT NULL,
  local_seq INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds (order_id);
CREATE UNIQUE INDEX IF NOT EXISTS refunds_local_seq_unique ON refunds (local_seq);
CREATE TABLE IF NOT EXISTS refund_lines (
  id TEXT PRIMARY KEY,
  refund_id TEXT NOT NULL,
  order_line_id TEXT NOT NULL,
  variant_id TEXT,
  qty INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  restock INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS refund_lines_refund_idx ON refund_lines (refund_id);
CREATE INDEX IF NOT EXISTS refund_lines_order_line_idx ON refund_lines (order_line_id);
-- parked carts (1C, FR-1.7) — device-local only, named, per register, survive
-- restart. Never enter the sync outbox.
CREATE TABLE IF NOT EXISTS parked_carts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  staff_id TEXT,
  cart TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS parked_carts_updated_idx ON parked_carts (updated_at);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  qty_delta INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  ref_order_id TEXT,
  client_created_at TEXT NOT NULL
);
-- shifts (1D, FR-6.1) — cash-drawer lifecycle. One open shift per register
-- enforced by the partial-unique index. Closed shifts carry the Z snapshot.
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  opened_by_staff_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_float INTEGER NOT NULL,
  closed_by_staff_id TEXT,
  closed_at TEXT,
  closing_counted INTEGER,
  closing_expected INTEGER,
  over_short INTEGER,
  z_snapshot TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  local_seq INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_register ON shifts (register_id) WHERE state = 'open';
-- cash movements (1D, FR-6.1) — paid in/out and no-sale drawer opens. Each is
-- its own auditable outbox fact with reason and staff attribution.
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL,
  approved_by_staff_id TEXT,
  client_created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_movements (shift_id);

-- outbox: appended in the SAME tx as the fact rows (atomicity — non-deferrable, phase doc §1B)
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  batch_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  pushed_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (pushed_at) WHERE pushed_at IS NULL;
`;

/** Idempotent: guarded by PRAGMA user_version, runs in one transaction. */
export function migrateDeviceDb(driver: SqlDriver): void {
  driver.tx(() => {
    const row = driver.get<{ user_version: number }>('PRAGMA user_version');
    const version = row?.user_version ?? 0;
    if (version >= DEVICE_SCHEMA_VERSION) return;
    for (const statement of DDL.split(';')) {
      // skip empty and comment-only chunks (comments must not contain ';')
      const hasStatement = statement
        .split('\n')
        .some((line) => line.trim() && !line.trim().startsWith('--'));
      if (hasStatement) driver.run(statement);
    }
    // v3: orders gains shift_id. Fresh installs get it from the CREATE above;
    // devices upgrading from v2 already have an orders table, so add it here.
    const orderCols = driver.all<{ name: string }>(`PRAGMA table_info(orders)`);
    if (!orderCols.some((col) => col.name === 'shift_id')) {
      driver.run(`ALTER TABLE orders ADD COLUMN shift_id TEXT`);
    }
    driver.run(
      `INSERT OR IGNORE INTO sync_state (id, schema_version) VALUES (1, ?)`,
      [DEVICE_SCHEMA_VERSION],
    );
    driver.run(`PRAGMA user_version = ${DEVICE_SCHEMA_VERSION}`);
  });
}
