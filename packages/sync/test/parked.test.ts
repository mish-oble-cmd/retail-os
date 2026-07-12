import { beforeEach, describe, expect, it } from 'vitest';
import { openBetterSqliteDriver } from '../src/better-sqlite3-driver.js';
import type { SqlDriver } from '../src/driver.js';
import {
  discardParkedCart,
  getParkedCart,
  listParkedCarts,
  parkCart,
  retrieveParkedCart,
} from '../src/parked.js';
import { migrateDeviceDb } from '../src/schema.js';

let driver: SqlDriver;

beforeEach(async () => {
  driver = await openBetterSqliteDriver(':memory:');
  migrateDeviceDb(driver);
});

const sampleCart = { lines: [{ variantId: 'V1', qty: 2 }], discounts: [] };

describe('parked carts', () => {
  it('parks and lists holds newest-first with summary fields', () => {
    parkCart(driver, {
      name: 'Table 4',
      cart: sampleCart,
      itemCount: 2,
      totalAmount: 500,
      currency: 'SGD',
    });
    parkCart(driver, {
      name: 'Mrs Tan',
      cart: sampleCart,
      itemCount: 1,
      totalAmount: 250,
      currency: 'SGD',
    });
    const list = listParkedCarts(driver);
    expect(list).toHaveLength(2);
    expect(list[0]?.name).toBe('Mrs Tan'); // most recently updated first
    expect(list[0]).toMatchObject({ itemCount: 1, totalAmount: 250, currency: 'SGD' });
  });

  it('re-hydrates the cart snapshot on read', () => {
    const id = parkCart(driver, {
      name: 'Table 4',
      cart: sampleCart,
      itemCount: 2,
      totalAmount: 500,
      currency: 'SGD',
    });
    expect(getParkedCart<typeof sampleCart>(driver, id)?.cart).toEqual(sampleCart);
  });

  it('updates an existing hold in place when id is supplied (upsert)', () => {
    const id = parkCart(driver, {
      name: 'Table 4',
      cart: sampleCart,
      itemCount: 2,
      totalAmount: 500,
      currency: 'SGD',
    });
    parkCart(driver, {
      id,
      name: 'Table 4 (updated)',
      cart: { lines: [], discounts: [] },
      itemCount: 0,
      totalAmount: 0,
      currency: 'SGD',
    });
    expect(listParkedCarts(driver)).toHaveLength(1);
    expect(getParkedCart(driver, id)?.name).toBe('Table 4 (updated)');
  });

  it('retrieve removes the hold and returns its snapshot exactly once', () => {
    const id = parkCart(driver, {
      name: 'Table 4',
      cart: sampleCart,
      itemCount: 2,
      totalAmount: 500,
      currency: 'SGD',
    });
    const retrieved = retrieveParkedCart<typeof sampleCart>(driver, id);
    expect(retrieved?.cart).toEqual(sampleCart);
    expect(listParkedCarts(driver)).toHaveLength(0);
    expect(retrieveParkedCart(driver, id)).toBeUndefined(); // already gone
  });

  it('discards a hold', () => {
    const id = parkCart(driver, {
      name: 'Table 4',
      cart: sampleCart,
      itemCount: 2,
      totalAmount: 500,
      currency: 'SGD',
    });
    discardParkedCart(driver, id);
    expect(listParkedCarts(driver)).toHaveLength(0);
  });
});
