import { describe, expect, it } from 'vitest';
import { openSqlJsDriver } from '../src/sqljs-driver.js';
import { migrateDeviceDb } from '../src/schema.js';
import { listParkedCarts, parkCart } from '../src/parked.js';

/**
 * The sql.js driver must satisfy the same synchronous SqlDriver contract as
 * better-sqlite3 (the device data layer is driver-agnostic) and round-trip a
 * snapshot so OPFS persistence works.
 */
describe('sql.js driver', () => {
  it('runs the device migration and basic CRUD synchronously', async () => {
    const driver = await openSqlJsDriver();
    migrateDeviceDb(driver);

    parkCart(driver, {
      name: 'Table 1',
      cart: { lines: [] },
      itemCount: 0,
      totalAmount: 0,
      currency: 'SGD',
    });
    expect(listParkedCarts(driver)).toHaveLength(1);
    driver.close();
  });

  it('rolls back a failed transaction', async () => {
    const driver = await openSqlJsDriver();
    migrateDeviceDb(driver);
    expect(() =>
      driver.tx(() => {
        parkCart(driver, {
          name: 'doomed',
          cart: {},
          itemCount: 0,
          totalAmount: 0,
          currency: 'SGD',
        });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(listParkedCarts(driver)).toHaveLength(0); // rolled back
    driver.close();
  });

  it('round-trips a snapshot: export then reopen preserves data', async () => {
    const first = await openSqlJsDriver();
    migrateDeviceDb(first);
    parkCart(first, {
      name: 'Persisted',
      cart: { lines: [{ v: 1 }] },
      itemCount: 1,
      totalAmount: 500,
      currency: 'SGD',
    });
    const snapshot = first.export();
    first.close();

    const reopened = await openSqlJsDriver({ data: snapshot });
    const carts = listParkedCarts(reopened);
    expect(carts).toHaveLength(1);
    expect(carts[0]?.name).toBe('Persisted');
    reopened.close();
  });

  it('invokes onPersist (coalesced) after commits', async () => {
    let snapshots = 0;
    const driver = await openSqlJsDriver({ onPersist: () => (snapshots += 1) });
    migrateDeviceDb(driver);
    parkCart(driver, { name: 'a', cart: {}, itemCount: 0, totalAmount: 0, currency: 'SGD' });
    parkCart(driver, { name: 'b', cart: {}, itemCount: 0, totalAmount: 0, currency: 'SGD' });
    // coalesced onto microtasks — let them drain
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(snapshots).toBeGreaterThan(0);
    driver.close();
  });
});
