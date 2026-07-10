/**
 * Catalog schema mechanics (Phase 1/1A, migration 0001):
 * - sync_rev is stamped by the bump_sync_rev trigger, monotonic per store,
 *   and bumps again on UPDATE (delta-feed correctness depends on this)
 * - the trigger refuses writes with no visible store (no tenant context)
 * - stock_movements are immutable for the app role (ledger invariant #4)
 * - RLS isolates every new table (spot-checked here; full per-resource
 *   coverage lives with each module's tests)
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  barcodes,
  inventoryLevels,
  locations,
  products,
  stockMovements,
  stores,
  taxCategories,
  variants,
} from '../src/db/schema';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  taxCategory: '01TAXCATAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAAA',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  taxCategory: '01TAXCATBBBBBBBBBBBBBBBBBB',
};

beforeAll(async () => {
  db = await createTestDb();
  await db.tenants.dangerouslyCrossTenant('test seed: two tenants', async (tx) => {
    for (const t of [A, B]) {
      const label = t === A ? 'A' : 'B';
      await tx.insert(stores).values({ id: t.store, name: `Store ${label}`, currency: 'SGD' });
      await tx
        .insert(taxCategories)
        .values({ id: t.taxCategory, storeId: t.store, name: 'Standard' });
    }
    await tx
      .insert(locations)
      .values({ id: A.location, storeId: A.store, name: 'Main' });
  });
});

afterAll(async () => {
  await db.close();
});

describe('sync_rev trigger', () => {
  it('stamps inserts with a monotonically increasing per-store revision', async () => {
    const revs = await db.tenants.forStore(A.store).tx(async (tx) => {
      const first = await tx
        .insert(products)
        .values({ id: '01PRODAAAAAAAAAAAAAAAAAAA1', storeId: A.store, name: 'Kopi', taxCategoryId: A.taxCategory })
        .returning({ syncRev: products.syncRev });
      const second = await tx
        .insert(products)
        .values({ id: '01PRODAAAAAAAAAAAAAAAAAAA2', storeId: A.store, name: 'Teh', taxCategoryId: A.taxCategory })
        .returning({ syncRev: products.syncRev });
      return [first[0]?.syncRev, second[0]?.syncRev];
    });
    expect(revs[0]).toBeGreaterThan(0);
    expect(revs[1]).toBeGreaterThan(revs[0] ?? Infinity);
  });

  it('bumps the revision on UPDATE so deltas pick the row up again', async () => {
    const { before, after } = await db.tenants.forStore(A.store).tx(async (tx) => {
      const inserted = await tx
        .insert(products)
        .values({ id: '01PRODAAAAAAAAAAAAAAAAAAA3', storeId: A.store, name: 'Milo', taxCategoryId: A.taxCategory })
        .returning({ syncRev: products.syncRev });
      const updated = await tx
        .update(products)
        .set({ name: 'Milo Dinosaur' })
        .where(eq(products.id, '01PRODAAAAAAAAAAAAAAAAAAA3'))
        .returning({ syncRev: products.syncRev });
      return { before: inserted[0]?.syncRev ?? 0, after: updated[0]?.syncRev ?? 0 };
    });
    expect(after).toBeGreaterThan(before);
  });

  it('two stores advance independent revision sequences', async () => {
    const revA = await db.tenants.forStore(A.store).tx(async (tx) => {
      const r = await tx
        .insert(products)
        .values({ id: '01PRODAAAAAAAAAAAAAAAAAAA4', storeId: A.store, name: 'Bandung', taxCategoryId: A.taxCategory })
        .returning({ syncRev: products.syncRev });
      return r[0]?.syncRev ?? 0;
    });
    const revB = await db.tenants.forStore(B.store).tx(async (tx) => {
      const r = await tx
        .insert(products)
        .values({ id: '01PRODBBBBBBBBBBBBBBBBBBB1', storeId: B.store, name: 'First', taxCategoryId: B.taxCategory })
        .returning({ syncRev: products.syncRev });
      return r[0]?.syncRev ?? 0;
    });
    // B's very first catalog write after seed: rev 2 (seed tax category was 1),
    // far below A's counter — proves counters are per store, not global.
    expect(revB).toBeLessThan(revA);
  });

  it('refuses catalog writes without a tenant context', async () => {
    await expect(
      db.appTx((tx) =>
        tx
          .insert(products)
          .values({ id: '01PRODXXXXXXXXXXXXXXXXXXXX', storeId: A.store, name: 'Ghost', taxCategoryId: A.taxCategory })
          .then(() => undefined),
      ),
    ).rejects.toThrow();
  });
});

describe('stock movement ledger', () => {
  it('accepts inserts and projects a level, but the app role cannot UPDATE or DELETE movements', async () => {
    await db.tenants.forStore(A.store).tx(async (tx) => {
      await tx.insert(variants).values({
        id: '01VARAAAAAAAAAAAAAAAAAAAA1',
        storeId: A.store,
        productId: '01PRODAAAAAAAAAAAAAAAAAAA1',
        priceAmount: 180,
      });
      await tx.insert(stockMovements).values({
        id: '01MOVAAAAAAAAAAAAAAAAAAAA1',
        storeId: A.store,
        variantId: '01VARAAAAAAAAAAAAAAAAAAAA1',
        locationId: A.location,
        qtyDelta: 10,
        movementType: 'count',
      });
      await tx.insert(inventoryLevels).values({
        id: '01LVLAAAAAAAAAAAAAAAAAAAA1',
        storeId: A.store,
        variantId: '01VARAAAAAAAAAAAAAAAAAAAA1',
        locationId: A.location,
        onHand: 10,
      });
    });

    await expect(
      db.tenants.forStore(A.store).tx((tx) =>
        tx
          .update(stockMovements)
          .set({ qtyDelta: 99 })
          .where(eq(stockMovements.id, '01MOVAAAAAAAAAAAAAAAAAAAA1')),
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.tenants.forStore(A.store).tx((tx) =>
        tx.delete(stockMovements).where(eq(stockMovements.id, '01MOVAAAAAAAAAAAAAAAAAAAA1')),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('catalog RLS spot checks', () => {
  it("store B cannot read store A's products", async () => {
    const rows = await db.tenants.forStore(B.store).tx((tx) =>
      tx.select().from(products).where(eq(products.storeId, A.store)),
    );
    expect(rows).toHaveLength(0);
  });

  it("store B cannot attach a barcode to store A's variant", async () => {
    await expect(
      db.tenants.forStore(B.store).tx((tx) =>
        tx.insert(barcodes).values({
          id: '01BARBBBBBBBBBBBBBBBBBBBB1',
          storeId: B.store,
          variantId: '01VARAAAAAAAAAAAAAAAAAAAA1',
          code: '8888888888888',
        }),
      ),
    ).rejects.toThrow();
  });

  it('barcode codes are unique per store, not globally', async () => {
    await db.tenants.forStore(A.store).tx((tx) =>
      tx.insert(barcodes).values({
        id: '01BARAAAAAAAAAAAAAAAAAAAA1',
        storeId: A.store,
        variantId: '01VARAAAAAAAAAAAAAAAAAAAA1',
        code: '8881234567890',
      }),
    );
    // Same code again in store A → unique violation.
    await expect(
      db.tenants.forStore(A.store).tx((tx) =>
        tx.insert(barcodes).values({
          id: '01BARAAAAAAAAAAAAAAAAAAAA2',
          storeId: A.store,
          variantId: '01VARAAAAAAAAAAAAAAAAAAAA1',
          code: '8881234567890',
        }),
      ),
    ).rejects.toThrow();
    // Same code in store B against its own variant → fine.
    await db.tenants.forStore(B.store).tx(async (tx) => {
      await tx.insert(variants).values({
        id: '01VARBBBBBBBBBBBBBBBBBBBB1',
        storeId: B.store,
        productId: '01PRODBBBBBBBBBBBBBBBBBBB1',
        priceAmount: 500,
      });
      await tx.insert(barcodes).values({
        id: '01BARBBBBBBBBBBBBBBBBBBBB2',
        storeId: B.store,
        variantId: '01VARBBBBBBBBBBBBBBBBBBBB1',
        code: '8881234567890',
      });
    });
  });
});

describe('signup seed compatibility', () => {
  it('cross-tenant writes (signup path) also get revisions stamped', async () => {
    const rev = await db.tenants.dangerouslyCrossTenant('test: simulate signup seed', async (tx) => {
      await tx.execute(sql`INSERT INTO stores (id, name, currency) VALUES ('01STORECCCCCCCCCCCCCCCCCCC', 'Store C', 'SGD')`);
      const rows = await tx
        .insert(taxCategories)
        .values({ id: '01TAXCATCCCCCCCCCCCCCCCCCC', storeId: '01STORECCCCCCCCCCCCCCCCCCC', name: 'Standard' })
        .returning({ syncRev: taxCategories.syncRev });
      return rows[0]?.syncRev;
    });
    // rev 1 goes to the store row itself (stores_sync_rev, 0003); first
    // catalog write takes rev 2.
    expect(rev).toBe(2);
  });
});
