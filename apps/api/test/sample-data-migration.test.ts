/**
 * Migration 0007 (1E, FR-10.1): the onboarding sample catalog tags its rows
 * with a nullable sample_batch_id so a one-click purge removes exactly that
 * batch. Nullable everywhere — real catalog rows are untouched.
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  await db.close();
});

describe('0007_sample_data', () => {
  it('adds a nullable sample_batch_id to the catalog tables', async () => {
    for (const table of ['products', 'variants', 'categories', 'inventory_levels']) {
      const rows = await db.appTx((tx) =>
        tx.execute(sql`
          SELECT is_nullable FROM information_schema.columns
          WHERE table_name = ${table} AND column_name = 'sample_batch_id'
        `),
      );
      expect(rows.rows[0]).toBeDefined();
      expect((rows.rows[0] as { is_nullable: string }).is_nullable).toBe('YES');
    }
  });
});
