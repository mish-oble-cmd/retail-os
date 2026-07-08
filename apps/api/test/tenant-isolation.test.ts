/**
 * Tenant-isolation suite (phase-0-foundations.md §0.4, CI-blocking per
 * testing-strategy.md §2): cross-store queries must fail — reads return
 * nothing, writes are rejected by Postgres row-level security itself.
 */
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { staff, stores, roles } from '../src/db/schema';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  role: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  staff: '01STAFFAAAAAAAAAAAAAAAAAAA',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  role: '01ROLEBBBBBBBBBBBBBBBBBBBB',
  staff: '01STAFFBBBBBBBBBBBBBBBBBBB',
};

beforeAll(async () => {
  db = await createTestDb();
  await db.tenants.dangerouslyCrossTenant('test seed: create two tenants', async (tx) => {
    for (const t of [A, B]) {
      const label = t === A ? 'A' : 'B';
      await tx.insert(stores).values({ id: t.store, name: `Store ${label}`, currency: 'PHP' });
      await tx
        .insert(roles)
        .values({ id: t.role, storeId: t.store, name: 'Owner', permissions: { owner: true } });
      await tx.insert(staff).values({
        id: t.staff,
        storeId: t.store,
        name: `Owner ${label}`,
        email: `owner-${label.toLowerCase()}@example.ph`,
        roleId: t.role,
      });
    }
  });
});

afterAll(async () => {
  await db.close();
});

describe('tenant isolation (RLS)', () => {
  it('a store sees exactly its own rows', async () => {
    const rows = await db.tenants.forStore(A.store).tx((tx) => tx.select().from(staff));
    expect(rows.map((r) => r.id)).toEqual([A.staff]);
  });

  it("selecting another store's row by primary key returns nothing", async () => {
    const rows = await db.tenants
      .forStore(A.store)
      .tx((tx) => tx.select().from(staff).where(eq(staff.id, B.staff)));
    expect(rows).toHaveLength(0);
  });

  it('without tenant context there are no rows at all', async () => {
    // Sanity: the seed really exists (admin role sees both tenants)…
    const asAdmin = await db.tenants.dangerouslyCrossTenant('test: verify seed exists', (tx) =>
      tx.select().from(staff),
    );
    expect(asAdmin).toHaveLength(2);
    // …but an app-role query that skipped forStore() gets nothing.
    const noContext = await db.appTx((tx) => tx.select().from(staff));
    expect(noContext).toHaveLength(0);
  });

  it('forStore rejects an empty store id', () => {
    expect(() => db.tenants.forStore('')).toThrow(/store id/);
  });

  it('inserting a row for another store is rejected by RLS WITH CHECK', async () => {
    await expect(
      db.tenants.forStore(A.store).tx((tx) =>
        tx.insert(staff).values({
          id: '01STAFFEVILAAAAAAAAAAAAAAA',
          storeId: B.store, // forged tenant
          name: 'Intruder',
          email: 'intruder@example.ph',
          roleId: B.role,
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("updating another store's rows affects nothing", async () => {
    const updated = await db.tenants
      .forStore(A.store)
      .tx((tx) =>
        tx.update(staff).set({ name: 'Hacked' }).where(eq(staff.id, B.staff)).returning(),
      );
    expect(updated).toHaveLength(0);
    const intact = await db.tenants
      .forStore(B.store)
      .tx((tx) => tx.select({ name: staff.name }).from(staff).where(eq(staff.id, B.staff)));
    expect(intact[0]?.name).toBe('Owner B');
  });

  it("deleting another store's rows affects nothing", async () => {
    const deleted = await db.tenants
      .forStore(A.store)
      .tx((tx) => tx.delete(staff).where(eq(staff.id, B.staff)).returning());
    expect(deleted).toHaveLength(0);
  });

  it('raw SQL inside a tenant transaction is scoped too (RLS, not the ORM, is the guard)', async () => {
    const result = await db.tenants
      .forStore(A.store)
      .tx((tx) => tx.execute(sql`SELECT id FROM staff`));
    const rows = (result as unknown as { rows: Array<{ id: string }> }).rows;
    expect(rows.map((r) => r.id)).toEqual([A.staff]);
  });

  it('stores table scopes on its own id', async () => {
    const visible = await db.tenants.forStore(A.store).tx((tx) => tx.select().from(stores));
    expect(visible.map((s) => s.id)).toEqual([A.store]);
  });

  it('dangerouslyCrossTenant demands a justification', async () => {
    await expect(
      db.tenants.dangerouslyCrossTenant('  ', (tx) => tx.select().from(stores)),
    ).rejects.toThrow(/justification/);
  });
});
