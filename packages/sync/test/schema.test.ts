import { describe, expect, it } from 'vitest';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import { DEVICE_SCHEMA_VERSION, migrateDeviceDb } from '../src/schema.js';

const EXPECTED_TABLES = [
  'sync_state',
  'store',
  'roles',
  'staff',
  'locations',
  'registers',
  'tax_categories',
  'tax_rates',
  'categories',
  'products',
  'variants',
  'barcodes',
  'inventory_levels',
  'orders',
  'order_lines',
  'payments',
  'refunds',
  'refund_lines',
  'parked_carts',
  'stock_movements',
  'outbox',
];

describe('migrateDeviceDb', () => {
  it('creates every mirror/fact table and is idempotent', async () => {
    const driver = await openBetterSqliteDriver(':memory:');
    migrateDeviceDb(driver);
    migrateDeviceDb(driver); // second run must be a no-op

    const tables = driver
      .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((row) => row.name);
    for (const table of EXPECTED_TABLES) expect(tables).toContain(table);

    const state = driver.get<{ id: number; last_ack_rev: number; schema_version: number }>(
      'SELECT id, last_ack_rev, schema_version FROM sync_state',
    );
    expect(state).toMatchObject({ id: 1, last_ack_rev: 0, schema_version: DEVICE_SCHEMA_VERSION });
    driver.close();
  });

  it('tx rolls back atomically on failure', async () => {
    const driver = await openBetterSqliteDriver(':memory:');
    migrateDeviceDb(driver);
    expect(() =>
      driver.tx(() => {
        driver.run(`INSERT INTO categories (id, name, sort, sync_rev) VALUES ('01CAT', 'A', 0, 1)`);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(driver.all('SELECT * FROM categories')).toHaveLength(0);
    driver.close();
  });
});
