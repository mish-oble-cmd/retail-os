import { beforeEach, describe, expect, it } from 'vitest';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import { SyncClient } from '../src/client.js';
import type { SqlDriver } from '../src/driver.js';
import type { LocalSaleInput } from '../src/outbox.js';
import { FakeSyncServer } from './fake-server.js';

let driver: SqlDriver;
let server: FakeSyncServer;
let online: boolean;

const makeClient = () =>
  new SyncClient({
    driver,
    baseUrl: 'http://fake/api/v1',
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      if (!online) throw new Error('network down');
      return server.asFetch()(input, init);
    }) as typeof fetch,
  });

const sale: LocalSaleInput = {
  id: 'ORDCLIENT00000000000000001',
  number: 'R1-000001',
  staffId: 'STAFF1',
  currency: 'SGD',
  totals: { subtotal: 500, discount: 0, tax: 41, total: 500 },
  taxLines: [{ rateId: 'TAXR1', amount: 41 }],
  lines: [
    {
      id: 'LINCLIENT00000000000000001',
      variantId: 'VAR1',
      name: 'Kopi',
      qty: 2,
      unitPriceAmount: 250,
      discounts: [],
      taxLines: [{ rateId: 'TAXR1', amount: 41 }],
      totalAmount: 500,
    },
  ],
  payments: [{ id: 'PAYCLIENT00000000000000001', tender: 'cash', amount: 500, change: 0 }],
  clientCreatedAt: '2026-07-11T05:00:00.000Z',
  localSeq: 1,
  movements: [
    {
      id: 'MOVCLIENT00000000000000001',
      variantId: 'VAR1',
      locationId: 'LOC1',
      qtyDelta: -2,
      movementType: 'sale',
    },
  ],
};

beforeEach(async () => {
  driver = await openBetterSqliteDriver(':memory:');
  server = new FakeSyncServer();
  server.addActivationCode('CODE1234', 'REG1');
  server.upsert('tax_rate', { id: 'TAXR1', tax_category_id: 'TAXC1', name: 'GST 9%', rate_bp: 900 });
  server.upsert('product', {
    id: 'PROD1',
    name: 'Kopi',
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
  server.upsert('variant', {
    id: 'VAR1',
    product_id: 'PROD1',
    option_values: {},
    sku: null,
    price_amount: 250,
    compare_at_amount: null,
    cost_amount: null,
    track_stock: true,
  });
  online = true;
});

describe('SyncClient lifecycle', () => {
  it('activate → bootstrap → offline sale → reconnect → synced exactly once', async () => {
    const client = makeClient();
    expect(client.status().state).toBe('never_bootstrapped');

    await client.activate('CODE1234', '0.1.0');
    // token survives via sync_state — a NEW client over the same db can bootstrap
    const rehydrated = makeClient();
    await rehydrated.bootstrap();
    expect(rehydrated.status().state).toBe('idle');
    expect(driver.get<{ name: string }>(`SELECT name FROM products WHERE id = 'PROD1'`)?.name).toBe('Kopi');

    // network dies mid-shift; the sale still completes locally
    online = false;
    rehydrated.recordSale(sale);
    expect(driver.get(`SELECT * FROM orders WHERE id = ?`, [sale.id])).toBeDefined();
    const status = rehydrated.status();
    expect(status.state).toBe('pending');
    expect(status.pendingFacts).toBe(2);
    await expect(rehydrated.sync({ retries: 0 })).rejects.toThrow('network down');

    // reconnect → the queued facts land exactly once
    online = true;
    const result = await rehydrated.sync();
    expect(result.pushed).toBe(2);
    expect(server.orders.has(sale.id)).toBe(true);
    expect(rehydrated.status().state).toBe('idle');

    // the marquee claim: replayed syncs never duplicate the sale
    await rehydrated.sync();
    await rehydrated.sync();
    expect(server.orders.size).toBe(1);
  });

  it('sync() pulls server-side changes down', async () => {
    const client = makeClient();
    await client.activate('CODE1234');
    await client.bootstrap();
    server.upsert('variant', {
      id: 'VAR1',
      product_id: 'PROD1',
      option_values: {},
      sku: null,
      price_amount: 300, // price change while register was busy
      compare_at_amount: null,
      cost_amount: null,
      track_stock: true,
    });
    const result = await client.sync();
    expect(result.pulled).toBe(1);
    expect(driver.get<{ price_amount: number }>(`SELECT price_amount FROM variants WHERE id = 'VAR1'`)?.price_amount).toBe(300);
  });

  it('activate failures surface as errors', async () => {
    const client = makeClient();
    await expect(client.activate('WRONG999')).rejects.toThrow();
    expect(client.status().state).toBe('never_bootstrapped');
  });
});
