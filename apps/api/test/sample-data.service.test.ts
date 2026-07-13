/**
 * 1E sample catalog (FR-10.1): seed the Singapore SGD convenience-store set
 * tagged with one sample_batch_id, then purge it in one click. A practice sale
 * against a sample variant survives purge — the order line keeps its name/price
 * snapshot while its variant_id FK is nulled, so reports are never corrupted.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { locations, orderLines, orders, products, registers, variants } from '../src/db/schema';
import { IdentityService } from '../src/modules/identity/identity.service';
import { SampleDataService } from '../src/modules/onboarding/sample-data.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let identity: IdentityService;
let sample: SampleDataService;

beforeAll(async () => {
  db = await createTestDb();
  identity = new IdentityService({ tenants: db.tenants } as unknown as DbService);
  sample = new SampleDataService({ tenants: db.tenants } as unknown as DbService);
});

afterAll(async () => {
  await db.close();
});

describe('SampleDataService', () => {
  it('seeds the SGD batch then purges it, preserving a practice order line', async () => {
    const who = await identity.signup({
      email: 'o@x.co',
      password: 'longenough12',
      name: 'O',
      storeName: 'M',
      currency: 'SGD',
    });

    const seeded = await sample.seed(who.storeId);
    expect(seeded.productCount).toBeGreaterThanOrEqual(40);

    // every seeded product carries the batch id
    const tagged = await db.tenants.forStore(who.storeId).tx((tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.sampleBatchId, seeded.batchId)),
    );
    expect(tagged.length).toBe(seeded.productCount);

    // simulate a practice sale against a sample variant
    const ctx = await db.tenants.forStore(who.storeId).tx(async (tx) => {
      const v = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.sampleBatchId, seeded.batchId))
        .limit(1);
      const reg = await tx.select({ id: registers.id }).from(registers).limit(1);
      const loc = await tx.select({ id: locations.id }).from(locations).limit(1);
      return { variantId: v[0]!.id, registerId: reg[0]!.id, locationId: loc[0]!.id };
    });

    await db.tenants.forStore(who.storeId).tx(async (tx) => {
      await tx.insert(orders).values({
        id: '01ORDERSAMPLEAAAAAAAAAAAAA',
        storeId: who.storeId,
        registerId: ctx.registerId,
        locationId: ctx.locationId,
        number: 'R1-0001',
        state: 'completed',
        currency: 'SGD',
        subtotalAmount: 180,
        totalAmount: 180,
      });
      await tx.insert(orderLines).values({
        id: '01LINESAMPLEAAAAAAAAAAAAAA',
        storeId: who.storeId,
        orderId: '01ORDERSAMPLEAAAAAAAAAAAAA',
        variantId: ctx.variantId,
        name: 'Practice Item',
        qty: 1,
        unitPriceAmount: 180,
        totalAmount: 180,
      });
    });

    const removed = await sample.purge(who.storeId);
    expect(removed.removed).toBe(seeded.productCount);

    const after = await db.tenants.forStore(who.storeId).tx(async (tx) => {
      const left = await tx
        .select({ id: products.id })
        .from(products)
        .where(isNotNull(products.sampleBatchId));
      const line = await tx
        .select({ variantId: orderLines.variantId, name: orderLines.name })
        .from(orderLines)
        .where(eq(orderLines.id, '01LINESAMPLEAAAAAAAAAAAAAA'));
      return { left: left.length, line: line[0]! };
    });

    expect(after.left).toBe(0); // batch fully removed
    expect(after.line.variantId).toBeNull(); // FK nulled
    expect(after.line.name).toBe('Practice Item'); // history preserved
  });

  it('refuses to seed twice', async () => {
    const who = await identity.signup({
      email: 'o2@x.co',
      password: 'longenough12',
      name: 'O2',
      storeName: 'M2',
      currency: 'SGD',
    });
    await sample.seed(who.storeId);
    await expect(sample.seed(who.storeId)).rejects.toThrow(/already/i);
  });
});
