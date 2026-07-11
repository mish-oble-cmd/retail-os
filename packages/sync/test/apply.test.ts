import { beforeEach, describe, expect, it } from 'vitest';
import { applyBootstrap, pullOnce } from '../src/apply.js';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import type { SqlDriver } from '../src/driver.js';
import { SyncHttp } from '../src/http.js';
import { migrateDeviceDb } from '../src/schema.js';
import { FakeSyncServer } from './fake-server.js';

let driver: SqlDriver;
let server: FakeSyncServer;
let http: SyncHttp;

beforeEach(async () => {
  driver = await openBetterSqliteDriver(':memory:');
  migrateDeviceDb(driver);
  server = new FakeSyncServer();
  server.deviceToken = 'rot_test_token';
  http = new SyncHttp({
    baseUrl: 'http://fake/api/v1',
    fetchImpl: server.asFetch(),
    getToken: () => 'rot_test_token',
  });

  server.upsert('tax_category', { id: 'TAXC1', name: 'Standard' });
  server.upsert('tax_rate', { id: 'TAXR1', tax_category_id: 'TAXC1', name: 'GST 9%', rate_bp: 900 });
  server.upsert('category', { id: 'CAT1', parent_id: null, name: 'Drinks', sort: 0 });
  server.upsert('product', {
    id: 'PROD1',
    name: 'Kopi',
    description: null,
    category_id: 'CAT1',
    brand: null,
    images: [],
    options: [],
    tax_category_id: 'TAXC1',
    status: 'active',
    has_variants: false,
    custom: {},
  });
  server.upsert('variant', {
    id: 'VAR1',
    product_id: 'PROD1',
    option_values: {},
    sku: 'KOPI',
    price_amount: 250,
    compare_at_amount: null,
    cost_amount: null,
    track_stock: true,
  });
  server.upsert('barcode', { id: 'BAR1', variant_id: 'VAR1', code: '888000111' });
  server.upsert('role', { id: 'ROLE1', name: 'Owner', permissions: { owner: true } });
  server.upsert('staff', { id: 'STAFF1', name: 'Ana', role_id: 'ROLE1', pin_hash: 'argon2id$pin', active: true });
  server.upsert('location', { id: 'LOC1', name: 'Main', timezone: 'Asia/Singapore', active: true });
  server.upsert('register', { id: 'REG1', location_id: 'LOC1', name: 'Front', grid_layout: { tiles: [] }, active: true });
  server.upsert('inventory_level', {
    id: 'LVL1',
    variant_id: 'VAR1',
    location_id: 'LOC1',
    on_hand: 100,
    reorder_point: null,
    reorder_qty: null,
  });
});

describe('applyBootstrap', () => {
  it('populates the mirror and sets last_ack_rev in one shot', async () => {
    const snapshot = await http.bootstrap();
    applyBootstrap(driver, snapshot);

    expect(driver.get<{ currency: string }>('SELECT currency FROM store')?.currency).toBe('SGD');
    expect(driver.get<{ name: string }>(`SELECT name FROM products WHERE id = 'PROD1'`)?.name).toBe('Kopi');
    expect(driver.get<{ price_amount: number }>(`SELECT price_amount FROM variants WHERE id = 'VAR1'`)?.price_amount).toBe(250);
    expect(driver.get<{ code: string }>(`SELECT code FROM barcodes WHERE id = 'BAR1'`)?.code).toBe('888000111');
    expect(driver.get<{ pin_hash: string }>(`SELECT pin_hash FROM staff WHERE id = 'STAFF1'`)?.pin_hash).toBe('argon2id$pin');
    expect(driver.get<{ on_hand: number }>(`SELECT on_hand FROM inventory_levels WHERE id = 'LVL1'`)?.on_hand).toBe(100);
    // JSON columns land as TEXT
    const gridLayout = driver.get<{ grid_layout: string }>(`SELECT grid_layout FROM registers WHERE id = 'REG1'`);
    expect(JSON.parse(gridLayout?.grid_layout ?? '')).toEqual({ tiles: [] });

    const state = driver.get<{ last_ack_rev: number }>('SELECT last_ack_rev FROM sync_state');
    expect(state?.last_ack_rev).toBe(snapshot.rev);
  });

  it('re-bootstrap replaces stale mirror rows', async () => {
    applyBootstrap(driver, await http.bootstrap());
    driver.run(`INSERT INTO products (id, name, tax_category_id, status, sync_rev) VALUES ('GHOST', 'Ghost', 'TAXC1', 'active', 1)`);
    applyBootstrap(driver, await http.bootstrap());
    expect(driver.all(`SELECT * FROM products WHERE id = 'GHOST'`)).toHaveLength(0);
  });
});

describe('pullOnce', () => {
  it('applies updates and tombstones, then goes idle', async () => {
    applyBootstrap(driver, await http.bootstrap());

    server.upsert('product', {
      id: 'PROD1',
      name: 'Kopi-O',
      description: null,
      category_id: null,
      brand: null,
      images: [],
      options: [],
      tax_category_id: 'TAXC1',
      status: 'active',
      has_variants: false,
      custom: {},
    });
    server.delete('category', 'CAT1');

    const result = await pullOnce(driver, http);
    expect(result.applied).toBe(2);
    expect(driver.get<{ name: string }>(`SELECT name FROM products WHERE id = 'PROD1'`)?.name).toBe('Kopi-O');
    expect(driver.all(`SELECT * FROM categories WHERE id = 'CAT1'`)).toHaveLength(0);

    const idle = await pullOnce(driver, http);
    expect(idle.applied).toBe(0);
  });

  it('pages through large deltas exactly once', async () => {
    applyBootstrap(driver, await http.bootstrap());
    for (let i = 0; i < 5; i += 1) {
      server.upsert('category', { id: `CATP${i}`, parent_id: null, name: `C${i}`, sort: i });
    }
    const result = await pullOnce(driver, http, { pageSize: 2 });
    expect(result.pages).toBe(3);
    expect(result.applied).toBe(5);
    expect(driver.all(`SELECT * FROM categories WHERE id LIKE 'CATP%'`)).toHaveLength(5);
  });
});
