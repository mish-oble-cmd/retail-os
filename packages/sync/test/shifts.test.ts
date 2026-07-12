import { beforeEach, describe, expect, it } from 'vitest';
import { buildZReport } from '@retailos/domain';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import type { SqlDriver } from '../src/driver.js';
import { migrateDeviceDb } from '../src/schema.js';
import { recordSale, type LocalSaleInput } from '../src/outbox.js';
import {
  closeShift,
  getActiveShift,
  getShiftZSource,
  openShift,
  recordCashMovement,
} from '../src/shifts.js';

let driver: SqlDriver;

beforeEach(async () => {
  driver = await openBetterSqliteDriver(':memory:');
  migrateDeviceDb(driver);
});

const open = (id = 'S1', registerId = 'R1', float = 200000, localSeq = 1) =>
  openShift(driver, {
    id,
    registerId,
    locationId: 'L1',
    openedByStaffId: 'ana',
    openingFloat: float,
    clientCreatedAt: 't0',
    localSeq,
  });

describe('shift lifecycle', () => {
  it('opens one shift and rejects a second open on the same register', () => {
    open();
    expect(getActiveShift(driver, 'R1')?.id).toBe('S1');
    expect(() => open('S2', 'R1', 100000, 2)).toThrow();
  });

  it('allows a concurrent open on a different register', () => {
    open('S1', 'R1', 200000, 1);
    open('S2', 'R2', 100000, 2);
    expect(getActiveShift(driver, 'R1')?.id).toBe('S1');
    expect(getActiveShift(driver, 'R2')?.id).toBe('S2');
  });

  it('records movements and closes with a Z snapshot, emitting facts in order', () => {
    open();
    recordCashMovement(driver, {
      id: 'M1',
      shiftId: 'S1',
      kind: 'paid_out',
      amount: 500,
      reason: 'LPG COD',
      staffId: 'ana',
      clientCreatedAt: 't1',
    });
    closeShift(driver, {
      id: 'S1',
      closedByStaffId: 'ana',
      closedAt: 't9',
      closingCounted: 199500,
      closingExpected: 199500,
      overShort: 0,
      z: buildZReport({ orders: [], refunds: [], movements: [], openingFloat: 200000, countedCash: 199500 }),
    });
    expect(getActiveShift(driver, 'R1')).toBeNull();
    const facts = driver
      .all<{ fact_type: string }>(`SELECT fact_type FROM outbox ORDER BY seq`)
      .map((r) => r.fact_type);
    expect(facts).toEqual(['shift.opened', 'cash.movement', 'shift.closed']);
    const closed = driver.get<{ state: string; over_short: number; z_snapshot: string }>(
      `SELECT state, over_short, z_snapshot FROM shifts WHERE id = 'S1'`,
    );
    expect(closed?.state).toBe('closed');
    expect(closed?.over_short).toBe(0);
    expect(JSON.parse(closed!.z_snapshot).openingFloat).toBe(200000);
  });
});

describe('getShiftZSource', () => {
  const sale = (id: string, tender: 'cash' | 'card_manual', total: number, tax: number): LocalSaleInput => ({
    id,
    number: id,
    staffId: 'ana',
    shiftId: 'S1',
    currency: 'PHP',
    totals: { subtotal: total - tax, discount: 0, tax, total },
    taxLines: [{ rateId: 'T1', amount: tax }],
    lines: [
      {
        id: `${id}-L1`,
        variantId: 'V1',
        name: 'Item',
        qty: 1,
        unitPriceAmount: total,
        discounts: [],
        taxLines: [{ rateId: 'T1', amount: tax }],
        totalAmount: total,
      },
    ],
    payments: [{ id: `${id}-P1`, tender, amount: total, change: 0 }],
    clientCreatedAt: 't2',
    localSeq: Number(id.replace(/\D/g, '')) || 1,
    movements: [],
  });

  it('gathers this shift orders, movements, and opening float for buildZReport', () => {
    open();
    recordSale(driver, sale('O1', 'cash', 1000, 100));
    recordSale(driver, sale('O2', 'card_manual', 2000, 200));
    recordCashMovement(driver, {
      id: 'M1',
      shiftId: 'S1',
      kind: 'paid_out',
      amount: 500,
      reason: 'x',
      staffId: 'ana',
      clientCreatedAt: 't3',
    });

    const src = getShiftZSource(driver, 'S1');
    expect(src.openingFloat).toBe(200000);
    expect(src.orders).toHaveLength(2);
    expect(src.movements).toEqual([{ kind: 'paid_out', amount: 500 }]);

    const z = buildZReport({ ...src, countedCash: 200000 + 1000 - 500 });
    expect(z.grossSales).toBe(3000);
    expect(z.tenders).toEqual({ cash: 1000, card_manual: 2000 });
    expect(z.expectedCash).toBe(200500); // 200000 + 1000 cash − 500 paid out
    expect(z.overShort).toBe(0);
  });
});
