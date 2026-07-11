import type { SqlDriver } from './driver.js';

/**
 * Device SQLite schema (1B): mirror of the ⬇-synced server tables plus the
 * locally-produced fact tables and the outbox. Conventions: snake_case,
 * money as INTEGER minor units, JSON payloads as TEXT, booleans as 0/1.
 * POS-07/08 read local orders for 60 days (offline-sync-strategy.md).
 */
export const DEVICE_SCHEMA_VERSION = 1;

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
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  qty_delta INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  ref_order_id TEXT,
  client_created_at TEXT NOT NULL
);

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
    driver.run(
      `INSERT OR IGNORE INTO sync_state (id, schema_version) VALUES (1, ?)`,
      [DEVICE_SCHEMA_VERSION],
    );
    driver.run(`PRAGMA user_version = ${DEVICE_SCHEMA_VERSION}`);
  });
}
