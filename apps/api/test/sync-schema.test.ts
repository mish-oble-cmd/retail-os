import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './pglite';

describe('0003_sync migration', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  const seed = async (storeId: string) => {
    await db.appTx(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE retailos_admin`);
      await tx.execute(sql`INSERT INTO stores (id, name, currency) VALUES (${storeId}, 's', 'SGD')`);
    });
  };

  it('bumps sync_rev on staff and registers writes', async () => {
    await seed('01STORE0000000000000000001');
    const t = db.tenants.forStore('01STORE0000000000000000001');
    await t.tx(async (tx) => {
      await tx.execute(
        sql`INSERT INTO roles (id, store_id, name) VALUES ('01ROLE0000000000000000001', '01STORE0000000000000000001', 'Owner')`,
      );
      await tx.execute(
        sql`INSERT INTO staff (id, store_id, name, role_id) VALUES ('01STAFF000000000000000001', '01STORE0000000000000000001', 'A', '01ROLE0000000000000000001')`,
      );
    });
    const rev = (await t.tx(async (tx) =>
      tx.execute(sql`SELECT sync_rev FROM staff WHERE id = '01STAFF000000000000000001'`),
    )) as { rows: { sync_rev: string }[] };
    expect(Number(rev.rows[0]?.sync_rev)).toBeGreaterThan(0);
  });

  it('store settings update bumps stores.sync_rev; catalog writes do not churn it', async () => {
    await seed('01STORE0000000000000000002');
    const t = db.tenants.forStore('01STORE0000000000000000002');
    const revOf = async () => {
      const result = (await t.tx(async (tx) =>
        tx.execute(sql`SELECT sync_rev FROM stores WHERE id = '01STORE0000000000000000002'`),
      )) as { rows: { sync_rev: string }[] };
      return Number(result.rows[0]?.sync_rev);
    };
    const before = await revOf();
    await t.tx(async (tx) =>
      tx.execute(
        sql`INSERT INTO tax_categories (id, store_id, name) VALUES ('01TAXC0000000000000000001', '01STORE0000000000000000002', 'Std')`,
      ),
    );
    // nested counter bump (depth 1) must not touch the store row's own rev
    expect(await revOf()).toBe(before);
    await t.tx(async (tx) =>
      tx.execute(sql`UPDATE stores SET name = 's2' WHERE id = '01STORE0000000000000000002'`),
    );
    expect(await revOf()).toBeGreaterThan(before);
  });

  it('deleting a category writes a tombstone with a fresh sync_rev', async () => {
    await seed('01STORE0000000000000000003');
    const t = db.tenants.forStore('01STORE0000000000000000003');
    await t.tx(async (tx) => {
      await tx.execute(
        sql`INSERT INTO categories (id, store_id, name) VALUES ('01CAT00000000000000000001', '01STORE0000000000000000003', 'Snacks')`,
      );
      await tx.execute(sql`DELETE FROM categories WHERE id = '01CAT00000000000000000001'`);
    });
    const result = (await t.tx(async (tx) =>
      tx.execute(sql`SELECT entity_type, entity_id, sync_rev FROM sync_tombstones`),
    )) as { rows: { entity_type: string; entity_id: string; sync_rev: string }[] };
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      entity_type: 'category',
      entity_id: '01CAT00000000000000000001',
    });
    expect(Number(result.rows[0]?.sync_rev)).toBeGreaterThan(0);
  });

  it('facts tables are append-only for retailos_app (no UPDATE on order_lines)', async () => {
    await seed('01STORE0000000000000000004');
    const t = db.tenants.forStore('01STORE0000000000000000004');
    await expect(
      t.tx(async (tx) => tx.execute(sql`UPDATE order_lines SET name = 'x'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it('RLS: no tenant context, no tombstone rows', async () => {
    const result = (await db.appTx(async (tx) =>
      tx.execute(sql`SELECT * FROM sync_tombstones`),
    )) as { rows: unknown[] };
    expect(result.rows).toHaveLength(0);
  });
});
