import { beforeEach, describe, expect, it } from 'vitest';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import type { SqlDriver } from '../src/driver.js';
import { recordRefund, recordSale, type LocalSaleInput } from '../src/outbox.js';
import {
  getOrderDetail,
  getStoreMeta,
  listRecentOrders,
  listSellableVariants,
  lookupBarcode,
  searchSellableVariants,
} from '../src/queries.js';
import { migrateDeviceDb } from '../src/schema.js';

let driver: SqlDriver;

/** Seeds a minimal catalog directly into the device mirror. */
function seedCatalog(d: SqlDriver): void {
  d.run(
    `INSERT INTO store (id, name, currency, timezone, price_mode, sync_rev)
     VALUES ('STORE1', 'Bahay Kubo', 'SGD', 'Asia/Singapore', 'tax_exclusive', 1)`,
  );
  d.run(`INSERT INTO tax_categories (id, name, sync_rev) VALUES ('TC1', 'Standard', 1)`);
  d.run(
    `INSERT INTO tax_rates (id, tax_category_id, name, rate_bp, sync_rev)
     VALUES ('TR1', 'TC1', 'GST 9%', 900, 1)`,
  );
  d.run(`INSERT INTO categories (id, parent_id, name, sort, sync_rev) VALUES ('CAT1', NULL, 'Drinks', 0, 1)`);
  d.run(
    `INSERT INTO products (id, name, category_id, tax_category_id, status, sync_rev)
     VALUES ('PROD1', 'Kopiko', 'CAT1', 'TC1', 'active', 1)`,
  );
  d.run(
    `INSERT INTO variants (id, product_id, option_values, sku, price_amount, track_stock, sync_rev)
     VALUES ('VAR1', 'PROD1', '{}', 'KOP-1', 100, 1, 1)`,
  );
  d.run(`INSERT INTO barcodes (id, variant_id, code, sync_rev) VALUES ('BC1', 'VAR1', '4800888', 1)`);
  d.run(
    `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, sync_rev)
     VALUES ('IL1', 'VAR1', 'LOC1', 20, 1)`,
  );
  // an inactive product must never surface in the grid
  d.run(
    `INSERT INTO products (id, name, tax_category_id, status, sync_rev)
     VALUES ('PROD2', 'Archived Soda', 'TC1', 'archived', 1)`,
  );
  d.run(
    `INSERT INTO variants (id, product_id, option_values, price_amount, track_stock, sync_rev)
     VALUES ('VAR2', 'PROD2', '{}', 150, 1, 1)`,
  );
}

const sale: LocalSaleInput = {
  id: 'ORD1',
  number: 'R1-0001',
  staffId: 'STAFF1',
  currency: 'SGD',
  totals: { subtotal: 300, discount: 0, tax: 27, total: 327 },
  taxLines: [{ rateId: 'TR1', amount: 27 }],
  lines: [
    {
      id: 'OL1',
      variantId: 'VAR1',
      name: 'Kopiko',
      qty: 3,
      unitPriceAmount: 100,
      discounts: [],
      taxLines: [{ rateId: 'TR1', amount: 27 }],
      totalAmount: 327,
    },
  ],
  payments: [{ id: 'PAY1', tender: 'cash', amount: 400, change: 73 }],
  clientCreatedAt: '2026-07-12T02:00:00.000Z',
  localSeq: 1,
  movements: [
    { id: 'MOV1', variantId: 'VAR1', locationId: 'LOC1', qtyDelta: -3, movementType: 'sale' },
  ],
};

beforeEach(async () => {
  driver = await openBetterSqliteDriver(':memory:');
  migrateDeviceDb(driver);
  seedCatalog(driver);
});

describe('queries', () => {
  it('reads store meta with price mode', () => {
    expect(getStoreMeta(driver)).toMatchObject({ currency: 'SGD', priceMode: 'tax_exclusive' });
  });

  it('lists only active sellable variants with aggregated on-hand', () => {
    const grid = listSellableVariants(driver);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toMatchObject({ variantId: 'VAR1', productName: 'Kopiko', onHand: 20, priceAmount: 100 });
  });

  it('filters the grid by category', () => {
    expect(listSellableVariants(driver, 'CAT1')).toHaveLength(1);
    expect(listSellableVariants(driver, 'CAT-NONE')).toHaveLength(0);
  });

  it('searches by name or sku, case-insensitive', () => {
    expect(searchSellableVariants(driver, 'kop')).toHaveLength(1);
    expect(searchSellableVariants(driver, 'KOP-1')).toHaveLength(1);
    expect(searchSellableVariants(driver, 'zzz')).toHaveLength(0);
  });

  it('looks up a barcode to a sellable variant', () => {
    expect(lookupBarcode(driver, '4800888')?.variantId).toBe('VAR1');
    expect(lookupBarcode(driver, 'nope')).toBeUndefined();
  });
});

describe('recordRefund + order detail', () => {
  beforeEach(() => recordSale(driver, sale));

  it('lists the sold order and reads its detail', () => {
    expect(listRecentOrders(driver).map((o) => o.number)).toContain('R1-0001');
    const detail = getOrderDetail(driver, 'ORD1');
    expect(detail?.lines[0]).toMatchObject({ qty: 3, refundedQty: 0 });
    expect(detail?.payments[0]?.changeAmount).toBe(73);
  });

  it('partial refund: sets partially_refunded, records restock movement + fact', () => {
    recordRefund(driver, {
      id: 'REF1',
      orderId: 'ORD1',
      staffId: 'STAFF1',
      approvedBy: 'OWNER1',
      currency: 'SGD',
      totalAmount: 109, // 327 × 1/3
      taxAmount: 9,
      taxLines: [{ rateId: 'TR1', amount: 9 }],
      tender: 'cash',
      lines: [{ id: 'RL1', orderLineId: 'OL1', variantId: 'VAR1', qty: 1, amount: 109, restock: true }],
      movements: [
        { id: 'RMOV1', variantId: 'VAR1', locationId: 'LOC1', qtyDelta: 1, movementType: 'refund_restock' },
      ],
      clientCreatedAt: '2026-07-12T03:00:00.000Z',
      localSeq: 2,
    });

    const detail = getOrderDetail(driver, 'ORD1');
    expect(detail?.state).toBe('partially_refunded');
    expect(detail?.lines[0]?.refundedQty).toBe(1);
    expect(detail?.refunds).toHaveLength(1);

    const movement = driver.get<{ qty_delta: number; movement_type: string }>(
      `SELECT qty_delta, movement_type FROM stock_movements WHERE id = 'RMOV1'`,
    );
    expect(movement).toMatchObject({ qty_delta: 1, movement_type: 'refund_restock' });

    const facts = driver
      .all<{ fact_type: string }>(`SELECT fact_type FROM outbox ORDER BY seq`)
      .map((r) => r.fact_type);
    expect(facts).toContain('refund.completed');
    expect(facts.filter((f) => f === 'stock.movement')).toHaveLength(2); // sale + restock
  });

  it('full refund of every unit sets state refunded', () => {
    recordRefund(driver, {
      id: 'REF2',
      orderId: 'ORD1',
      staffId: 'STAFF1',
      currency: 'SGD',
      totalAmount: 327,
      taxAmount: 27,
      taxLines: [{ rateId: 'TR1', amount: 27 }],
      tender: 'cash',
      lines: [{ id: 'RL2', orderLineId: 'OL1', variantId: 'VAR1', qty: 3, amount: 327, restock: false }],
      movements: [],
      clientCreatedAt: '2026-07-12T03:00:00.000Z',
      localSeq: 2,
    });
    expect(getOrderDetail(driver, 'ORD1')?.state).toBe('refunded');
  });

  it('rejects a refund with no staff attribution or no lines', () => {
    expect(() =>
      recordRefund(driver, {
        id: 'REF3',
        orderId: 'ORD1',
        staffId: '',
        currency: 'SGD',
        totalAmount: 0,
        taxAmount: 0,
        taxLines: [],
        tender: 'cash',
        lines: [{ id: 'RL3', orderLineId: 'OL1', qty: 1, amount: 109, restock: false }],
        movements: [],
        clientCreatedAt: '2026-07-12T03:00:00.000Z',
        localSeq: 2,
      }),
    ).toThrow(/staffId is required/);

    expect(() =>
      recordRefund(driver, {
        id: 'REF4',
        orderId: 'ORD1',
        staffId: 'STAFF1',
        currency: 'SGD',
        totalAmount: 0,
        taxAmount: 0,
        taxLines: [],
        tender: 'cash',
        lines: [],
        movements: [],
        clientCreatedAt: '2026-07-12T03:00:00.000Z',
        localSeq: 2,
      }),
    ).toThrow(/at least one refund line/);
  });
});
