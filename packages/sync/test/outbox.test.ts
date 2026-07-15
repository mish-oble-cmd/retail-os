import { beforeEach, describe, expect, it } from 'vitest';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import type { SqlDriver } from '../src/driver.js';
import { SyncHttp } from '../src/http.js';
import {
  claimBatch,
  markPushed,
  pendingCount,
  pushOnce,
  pushWithRetry,
  recordSale,
  type LocalSaleInput,
} from '../src/outbox.js';
import { migrateDeviceDb } from '../src/schema.js';
import { FakeSyncServer } from './fake-server.js';

let driver: SqlDriver;
let server: FakeSyncServer;
let http: SyncHttp;
let seq = 0;

const makeSale = (overrides?: Partial<LocalSaleInput>): LocalSaleInput => {
  seq += 1;
  const orderId = `ORD${String(seq).padStart(10, '0')}`;
  return {
    id: orderId,
    number: `R1-${String(seq).padStart(6, '0')}`,
    staffId: 'STAFF1',
    currency: 'SGD',
    totals: { subtotal: 500, discount: 0, tax: 41, total: 500 },
    taxLines: [{ rateId: 'TAXR1', amount: 41 }],
    lines: [
      {
        id: `LIN${String(seq).padStart(10, '0')}`,
        variantId: 'VAR1',
        name: 'Kopi',
        qty: 2,
        unitPriceAmount: 250,
        discounts: [],
        taxLines: [{ rateId: 'TAXR1', amount: 41 }],
        totalAmount: 500,
      },
    ],
    payments: [
      { id: `PAY${String(seq).padStart(10, '0')}`, tender: 'cash', amount: 500, change: 0 },
    ],
    clientCreatedAt: '2026-07-11T04:00:00.000Z',
    localSeq: seq,
    movements: [
      {
        id: `MOV${String(seq).padStart(10, '0')}`,
        variantId: 'VAR1',
        locationId: 'LOC1',
        qtyDelta: -2,
        movementType: 'sale',
      },
    ],
    ...overrides,
  };
};

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
});

describe('recordSale', () => {
  it('writes fact rows and outbox entries in one atomic tx', () => {
    const sale = makeSale();
    recordSale(driver, sale);
    expect(driver.get(`SELECT * FROM orders WHERE id = ?`, [sale.id])).toBeDefined();
    expect(driver.all(`SELECT * FROM order_lines WHERE order_id = ?`, [sale.id])).toHaveLength(1);
    expect(driver.all(`SELECT * FROM payments WHERE order_id = ?`, [sale.id])).toHaveLength(1);
    expect(driver.all(`SELECT * FROM stock_movements`)).toHaveLength(1);
    expect(pendingCount(driver)).toBe(2); // order.completed + stock.movement
  });

  it('stamps shift_id on the order row and the order.completed fact (1D)', () => {
    const sale = makeSale({ shiftId: 'SHIFT1' });
    recordSale(driver, sale);
    const row = driver.get<{ shift_id: string | null }>(`SELECT shift_id FROM orders WHERE id = ?`, [
      sale.id,
    ]);
    expect(row?.shift_id).toBe('SHIFT1');
    const fact = driver.get<{ payload: string }>(
      `SELECT payload FROM outbox WHERE fact_type = 'order.completed' AND entity_id = ?`,
      [sale.id],
    );
    expect(JSON.parse(fact!.payload).shift_id).toBe('SHIFT1');
  });

  it('rolls back everything when any row fails — no half-recorded sale', () => {
    const sale = makeSale();
    const movement = sale.movements[0];
    if (!movement) throw new Error('fixture needs a movement');
    const broken: LocalSaleInput = {
      ...sale,
      movements: [movement, { ...movement }], // duplicate movement id → PK violation
    };
    expect(() => recordSale(driver, broken)).toThrow();
    expect(driver.all(`SELECT * FROM orders`)).toHaveLength(0);
    expect(driver.all(`SELECT * FROM order_lines`)).toHaveLength(0);
    expect(driver.all(`SELECT * FROM payments`)).toHaveLength(0);
    expect(driver.all(`SELECT * FROM stock_movements`)).toHaveLength(0);
    expect(pendingCount(driver)).toBe(0);
  });

  it('refuses a sale without staff attribution (1F)', () => {
    const unattributed = { ...makeSale(), staffId: undefined } as unknown as LocalSaleInput;
    expect(() => recordSale(driver, unattributed)).toThrow(/staffId is required/);
    expect(pendingCount(driver)).toBe(0); // nothing half-written
  });
});

describe('claimBatch / markPushed', () => {
  it('re-claiming before ack returns the SAME batch id (crash-safe idempotency key)', () => {
    recordSale(driver, makeSale());
    const first = claimBatch(driver);
    const second = claimBatch(driver);
    expect(first).not.toBeNull();
    expect(second?.batchId).toBe(first?.batchId);
    expect(second?.facts).toEqual(first?.facts);
  });

  it('caps a batch at max facts and drains in seq order', () => {
    for (let i = 0; i < 5; i += 1) recordSale(driver, makeSale());
    const batch = claimBatch(driver, 4);
    expect(batch?.facts).toHaveLength(4);
    markPushed(driver, batch?.batchId ?? '', []);
    const rest = claimBatch(driver, 500);
    expect(rest?.facts).toHaveLength(6); // 10 total entries - 4 pushed
    expect(rest?.batchId).not.toBe(batch?.batchId);
  });
});

describe('pushOnce / pushWithRetry', () => {
  it('pushes pending facts, marks them, then reports nothing to do', async () => {
    const sale = makeSale();
    recordSale(driver, sale);
    const result = await pushOnce(driver, http, 'REG1');
    expect(result).toEqual({ pushed: 2 });
    expect(server.orders.has(sale.id)).toBe(true);
    expect(pendingCount(driver)).toBe(0);
    expect(await pushOnce(driver, http, 'REG1')).toBeNull();
  });

  it('replays idempotently when the first ack was lost', async () => {
    const sale = makeSale();
    recordSale(driver, sale);
    const claimed = claimBatch(driver);
    if (!claimed) throw new Error('expected a claimed batch');
    // simulate: batch reached the server but the ack never made it back
    await http.postBatch({
      batch_id: claimed.batchId,
      client: { register_id: 'REG1' },
      facts: claimed.facts,
    });
    const ordersBefore = server.orders.size;
    const result = await pushOnce(driver, http, 'REG1');
    expect(result).toEqual({ pushed: 2 });
    expect(server.orders.size).toBe(ordersBefore); // no double-apply
    expect(pendingCount(driver)).toBe(0);
  });

  it('pushWithRetry survives transient network failure with one batch id', async () => {
    recordSale(driver, makeSale());
    let failures = 2;
    const seenBatchIds = new Set<string>();
    const flakyFetch: typeof fetch = async (input, init) => {
      if (String(input).includes('/sync/batches')) {
        seenBatchIds.add((JSON.parse(String(init?.body)) as { batch_id: string }).batch_id);
        if (failures > 0) {
          failures -= 1;
          throw new Error('network down');
        }
      }
      return server.asFetch()(input, init);
    };
    const flakyHttp = new SyncHttp({
      baseUrl: 'http://fake/api/v1',
      fetchImpl: flakyFetch,
      getToken: () => 'rot_test_token',
    });
    const result = await pushWithRetry(driver, flakyHttp, 'REG1', {
      retries: 5,
      baseDelayMs: 1,
      jitter: () => 0.5,
    });
    expect(result.pushed).toBe(2);
    expect(seenBatchIds.size).toBe(1); // same idempotency key across retries
    expect(pendingCount(driver)).toBe(0);
  });

  it('pushWithRetry gives up after exhausting retries', async () => {
    recordSale(driver, makeSale());
    const deadHttp = new SyncHttp({
      baseUrl: 'http://fake/api/v1',
      fetchImpl: async () => {
        throw new Error('network down');
      },
      getToken: () => 'rot_test_token',
    });
    await expect(
      pushWithRetry(driver, deadHttp, 'REG1', { retries: 2, baseDelayMs: 1, jitter: () => 0.5 }),
    ).rejects.toThrow('network down');
    expect(pendingCount(driver)).toBe(2); // nothing lost; next run retries the same batch
  });
});
