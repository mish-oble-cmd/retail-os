/**
 * 1E sample catalog (FR-10.1): seed the Singapore SGD convenience-store set
 * tagged with one sample_batch_id, then purge it in one click.
 *
 * A practice sale writes an immutable stock_movement + order that FK-block
 * deleting the sold variant, so purge runs under the admin escalation and
 * removes the practice ledger too. Pure practice orders are deleted outright; a
 * mixed order that also holds a real line keeps that line (only its sample line
 * is detached) so a real sale is never lost.
 */
import { eq, isNotNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import {
  locations,
  orderLines,
  orders,
  products,
  registers,
  stockMovements,
  taxCategories,
  variants,
} from '../src/db/schema';
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

async function seededContext(storeId: string) {
  return db.tenants.forStore(storeId).tx(async (tx) => {
    const reg = await tx.select({ id: registers.id }).from(registers).limit(1);
    const loc = await tx.select({ id: locations.id }).from(locations).limit(1);
    const tax = await tx.select({ id: taxCategories.id }).from(taxCategories).limit(1);
    return { registerId: reg[0]!.id, locationId: loc[0]!.id, taxCategoryId: tax[0]!.id };
  });
}

describe('SampleDataService', () => {
  it('seeds the SGD batch then purges it, deleting the practice sale and its ledger', async () => {
    const who = await identity.signup({
      email: 'o@x.co',
      password: 'longenough12',
      name: 'O',
      storeName: 'M',
      currency: 'SGD',
    });

    const seeded = await sample.seed(who.storeId);
    expect(seeded.productCount).toBeGreaterThanOrEqual(40);

    const tagged = await db.tenants.forStore(who.storeId).tx((tx) =>
      tx.select({ id: products.id }).from(products).where(eq(products.sampleBatchId, seeded.batchId)),
    );
    expect(tagged.length).toBe(seeded.productCount);

    const ctx = await seededContext(who.storeId);
    const sampleVariant = await db.tenants.forStore(who.storeId).tx((tx) =>
      tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.sampleBatchId, seeded.batchId))
        .limit(1),
    );
    const variantId = sampleVariant[0]!.id;

    // Practice sale: order + line + an immutable stock_movement on the sample
    // variant (the movement is what FK-blocks a naive delete).
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
        variantId,
        name: 'Practice Item',
        qty: 1,
        unitPriceAmount: 180,
        totalAmount: 180,
      });
      await tx.insert(stockMovements).values({
        id: '01MOVESAMPLEAAAAAAAAAAAAAA',
        storeId: who.storeId,
        variantId,
        locationId: ctx.locationId,
        qtyDelta: -1,
        movementType: 'sale',
        refType: 'order',
        refId: '01ORDERSAMPLEAAAAAAAAAAAAA',
      });
    });

    const removed = await sample.purge(who.storeId);
    expect(removed.removed).toBe(seeded.productCount);

    const after = await db.tenants.forStore(who.storeId).tx(async (tx) => {
      const left = await tx
        .select({ id: products.id })
        .from(products)
        .where(isNotNull(products.sampleBatchId));
      const order = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, '01ORDERSAMPLEAAAAAAAAAAAAA'));
      const line = await tx
        .select({ id: orderLines.id })
        .from(orderLines)
        .where(eq(orderLines.id, '01LINESAMPLEAAAAAAAAAAAAAA'));
      const move = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(eq(stockMovements.id, '01MOVESAMPLEAAAAAAAAAAAAAA'));
      return { left: left.length, order: order.length, line: line.length, move: move.length };
    });

    expect(after.left).toBe(0); // batch fully removed
    expect(after.order).toBe(0); // pure practice order deleted
    expect(after.line).toBe(0); // its line deleted
    expect(after.move).toBe(0); // its stock movement deleted
  });

  it('keeps a mixed order and its real line, detaching only the sample line', async () => {
    const who = await identity.signup({
      email: 'mixed@x.co',
      password: 'longenough12',
      name: 'Mixed',
      storeName: 'Mixed Store',
      currency: 'SGD',
    });
    const seeded = await sample.seed(who.storeId);
    const ctx = await seededContext(who.storeId);

    const sampleVariant = await db.tenants.forStore(who.storeId).tx((tx) =>
      tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.sampleBatchId, seeded.batchId))
        .limit(1),
    );
    const sampleVariantId = sampleVariant[0]!.id;

    // A real (non-sample) product + variant the owner added themselves.
    await db.tenants.forStore(who.storeId).tx(async (tx) => {
      await tx.insert(products).values({
        id: '01REALPRODUCTAAAAAAAAAAAAA',
        storeId: who.storeId,
        name: 'Real Product',
        taxCategoryId: ctx.taxCategoryId,
        status: 'active',
      });
      await tx.insert(variants).values({
        id: '01REALVARIANTAAAAAAAAAAAAA',
        storeId: who.storeId,
        productId: '01REALPRODUCTAAAAAAAAAAAAA',
        priceAmount: 500,
      });
      // One order with a sample line AND a real line.
      await tx.insert(orders).values({
        id: '01MIXEDORDERAAAAAAAAAAAAAA',
        storeId: who.storeId,
        registerId: ctx.registerId,
        locationId: ctx.locationId,
        number: 'R1-0002',
        state: 'completed',
        currency: 'SGD',
        subtotalAmount: 680,
        totalAmount: 680,
      });
      await tx.insert(orderLines).values([
        {
          id: '01MIXEDSAMPLELINEAAAAAAAAA',
          storeId: who.storeId,
          orderId: '01MIXEDORDERAAAAAAAAAAAAAA',
          variantId: sampleVariantId,
          name: 'Sample Line',
          qty: 1,
          unitPriceAmount: 180,
          totalAmount: 180,
        },
        {
          id: '01MIXEDREALLINEAAAAAAAAAAA',
          storeId: who.storeId,
          orderId: '01MIXEDORDERAAAAAAAAAAAAAA',
          variantId: '01REALVARIANTAAAAAAAAAAAAA',
          name: 'Real Line',
          qty: 1,
          unitPriceAmount: 500,
          totalAmount: 500,
        },
      ]);
    });

    await sample.purge(who.storeId);

    const after = await db.tenants.forStore(who.storeId).tx(async (tx) => {
      const order = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.id, '01MIXEDORDERAAAAAAAAAAAAAA'));
      const realLine = await tx
        .select({ variantId: orderLines.variantId })
        .from(orderLines)
        .where(eq(orderLines.id, '01MIXEDREALLINEAAAAAAAAAAA'));
      const sampleLine = await tx
        .select({ variantId: orderLines.variantId, name: orderLines.name })
        .from(orderLines)
        .where(eq(orderLines.id, '01MIXEDSAMPLELINEAAAAAAAAA'));
      const realVariant = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.id, '01REALVARIANTAAAAAAAAAAAAA'));
      return {
        order: order.length,
        realLineVariant: realLine[0]?.variantId,
        sampleLineVariant: sampleLine[0]?.variantId,
        sampleLineName: sampleLine[0]?.name,
        realVariant: realVariant.length,
      };
    });

    expect(after.order).toBe(1); // mixed order kept
    expect(after.realLineVariant).toBe('01REALVARIANTAAAAAAAAAAAAA'); // real line untouched
    expect(after.realVariant).toBe(1); // real variant untouched
    expect(after.sampleLineVariant).toBeNull(); // sample line detached
    expect(after.sampleLineName).toBe('Sample Line'); // snapshot preserved
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
