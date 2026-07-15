/**
 * Sync surface (1B): bootstrap snapshot, delta feed with tombstones and
 * paging, batch ingest with idempotent replay + domain revalidation.
 */
import { calculateCart } from '@retailos/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import {
  barcodes,
  categories,
  inventoryLevels,
  locations,
  orderLines,
  orders,
  payments,
  products,
  refundLines,
  refunds,
  registers,
  roles,
  staff,
  stockMovements,
  stores,
  syncConflicts,
  taxCategories,
  taxRates,
  variants,
} from '../src/db/schema';
import type { DeviceContext } from '../src/modules/sync/devices.service';
import type { SyncBatchInput } from '../src/modules/sync/dto';
import { SyncService } from '../src/modules/sync/sync.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let syncService: SyncService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  role: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  staff: '01STAFFAAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAA1',
  register: '01REGAAAAAAAAAAAAAAAAAAAA1',
  taxCategory: '01TAXCAAAAAAAAAAAAAAAAAAA1',
  taxRate: '01TAXRAAAAAAAAAAAAAAAAAAA1',
  category: '01CATAAAAAAAAAAAAAAAAAAAA1',
  product: '01PRODAAAAAAAAAAAAAAAAAAA1',
  variant: '01VARAAAAAAAAAAAAAAAAAAAA1',
  barcode: '01BARAAAAAAAAAAAAAAAAAAAA1',
  level: '01LVLAAAAAAAAAAAAAAAAAAAA1',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  taxCategory: '01TAXCBBBBBBBBBBBBBBBBBBB1',
  product: '01PRODBBBBBBBBBBBBBBBBBBB1',
};

const ctx: DeviceContext = {
  deviceId: '01DEVAAAAAAAAAAAAAAAAAAAA1',
  storeId: A.store,
  registerId: A.register,
  locationId: A.location,
};

beforeAll(async () => {
  db = await createTestDb();
  syncService = new SyncService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values([
      { id: A.store, name: 'Store A', currency: 'SGD', timezone: 'Asia/Singapore' },
      { id: B.store, name: 'Store B', currency: 'SGD' },
    ]);
    await tx.insert(roles).values({
      id: A.role,
      storeId: A.store,
      name: 'Owner',
      permissions: { owner: true },
    });
    await tx.insert(staff).values({
      id: A.staff,
      storeId: A.store,
      name: 'Owner A',
      roleId: A.role,
      passwordHash: 'argon2id$SECRET-NEVER-SYNCS',
      pinHash: 'argon2id$pin',
      totpSecret: 'TOTP-SECRET-NEVER-SYNCS',
    });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
    await tx.insert(registers).values({
      id: A.register,
      storeId: A.store,
      locationId: A.location,
      name: 'Front',
      gridLayout: { tiles: [] },
    });
    await tx.insert(taxCategories).values([
      { id: A.taxCategory, storeId: A.store, name: 'Standard' },
      { id: B.taxCategory, storeId: B.store, name: 'Standard' },
    ]);
    await tx.insert(taxRates).values({
      id: A.taxRate,
      storeId: A.store,
      taxCategoryId: A.taxCategory,
      name: 'GST 9%',
      rateBp: 900,
    });
    await tx.insert(categories).values({ id: A.category, storeId: A.store, name: 'Drinks' });
    await tx.insert(products).values([
      {
        id: A.product,
        storeId: A.store,
        name: 'Kopi',
        categoryId: A.category,
        taxCategoryId: A.taxCategory,
        status: 'active',
      },
      // other tenant noise — must never appear in store A's feed
      {
        id: B.product,
        storeId: B.store,
        name: 'Other Store Secret',
        taxCategoryId: B.taxCategory,
        status: 'active',
      },
    ]);
    await tx.insert(variants).values({
      id: A.variant,
      storeId: A.store,
      productId: A.product,
      priceAmount: 250,
    });
    await tx.insert(barcodes).values({ id: A.barcode, storeId: A.store, variantId: A.variant, code: '888000111' });
    await tx.insert(inventoryLevels).values({
      id: A.level,
      storeId: A.store,
      variantId: A.variant,
      locationId: A.location,
      onHand: 100,
    });
  });
});

afterAll(async () => {
  await db.close();
});

describe('SyncService.bootstrap', () => {
  it('returns a consistent snapshot of every down-synced entity', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    expect(snapshot.rev).toBeGreaterThan(0);
    expect(snapshot.store).toMatchObject({ id: A.store, currency: 'SGD', price_mode: 'tax_inclusive' });
    expect(snapshot.data.roles.map((r) => r.id)).toEqual([A.role]);
    expect(snapshot.data.staff.map((s) => s.id)).toEqual([A.staff]);
    expect(snapshot.data.locations.map((l) => l.id)).toEqual([A.location]);
    expect(snapshot.data.registers.map((r) => r.id)).toEqual([A.register]);
    expect(snapshot.data.tax_categories.map((t) => t.id)).toEqual([A.taxCategory]);
    expect(snapshot.data.tax_rates[0]).toMatchObject({ id: A.taxRate, rate_bp: 900 });
    expect(snapshot.data.categories.map((c) => c.id)).toEqual([A.category]);
    expect(snapshot.data.products.map((p) => p.id)).toEqual([A.product]);
    expect(snapshot.data.variants[0]).toMatchObject({ id: A.variant, price_amount: 250 });
    expect(snapshot.data.barcodes[0]).toMatchObject({ id: A.barcode, code: '888000111' });
    expect(snapshot.data.inventory_levels[0]).toMatchObject({ id: A.level, on_hand: 100 });

    // rev covers every row in the snapshot
    const maxRowRev = Math.max(
      ...Object.values(snapshot.data).flatMap((rows) => rows.map((row) => Number(row.sync_rev))),
    );
    expect(snapshot.rev).toBeGreaterThanOrEqual(maxRowRev);
  });

  it('staff sync down is a projection: pin_hash yes, secrets no', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    const staffRow = snapshot.data.staff[0] as Record<string, unknown>;
    expect(staffRow['pin_hash']).toBe('argon2id$pin');
    expect(staffRow).not.toHaveProperty('password_hash');
    expect(staffRow).not.toHaveProperty('totp_secret');
    expect(staffRow).not.toHaveProperty('email');
    expect(JSON.stringify(snapshot)).not.toContain('SECRET-NEVER-SYNCS');
  });

  it('never leaks another tenant', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    expect(JSON.stringify(snapshot)).not.toContain(B.product);
    expect(JSON.stringify(snapshot)).not.toContain('Other Store Secret');
  });
});

describe('SyncService.changes', () => {
  it('returns the full history ascending by rev with no tenant leaks', async () => {
    const page = await syncService.changes(ctx, 0, 500);
    expect(page.has_more).toBe(false);
    const revs = page.changes.map((c) => c.rev);
    expect(revs).toEqual([...revs].sort((a, b) => a - b));
    expect(page.next_since).toBe(revs[revs.length - 1]);
    const types = new Set(page.changes.map((c) => c.type));
    for (const expected of [
      'store',
      'role',
      'staff',
      'location',
      'register',
      'tax_category',
      'tax_rate',
      'category',
      'product',
      'variant',
      'barcode',
      'inventory_level',
    ]) {
      expect(types).toContain(expected);
    }
    expect(JSON.stringify(page)).not.toContain('Other Store Secret');
  });

  it('staff change rows use the pin projection', async () => {
    const page = await syncService.changes(ctx, 0, 500);
    const staffChange = page.changes.find((c) => c.type === 'staff');
    expect(staffChange?.data['pin_hash']).toBe('argon2id$pin');
    expect(staffChange?.data).not.toHaveProperty('password_hash');
  });

  it('after an update, only the touched row comes back', async () => {
    const before = await syncService.changes(ctx, 0, 500);
    const since = before.next_since;
    await db.tenants.forStore(A.store).tx(async (tx) => {
      await tx.update(products).set({ name: 'Kopi-O' }).where(eq(products.id, A.product));
    });
    const page = await syncService.changes(ctx, since, 500);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]).toMatchObject({ type: 'product', data: { id: A.product, name: 'Kopi-O' } });
    expect(page.changes[0]?.rev).toBeGreaterThan(since);
    expect(page.has_more).toBe(false);
    // idle feed: nothing since the last ack
    const idle = await syncService.changes(ctx, page.next_since, 500);
    expect(idle.changes).toHaveLength(0);
    expect(idle.next_since).toBe(page.next_since);
  });

  it('a deletion arrives as a tombstone', async () => {
    const since = (await syncService.changes(ctx, 0, 500)).next_since;
    await db.tenants.forStore(A.store).tx(async (tx) => {
      // detach the product first, as the categories service does on delete
      await tx.update(products).set({ categoryId: null }).where(eq(products.categoryId, A.category));
      await tx.delete(categories).where(eq(categories.id, A.category));
    });
    const page = await syncService.changes(ctx, since, 500);
    const tombstone = page.changes.find((c) => c.type === 'tombstone');
    expect(tombstone?.data).toMatchObject({ entity_type: 'category', entity_id: A.category });
  });

  it('a re-created then re-deleted entity still yields one tombstone', async () => {
    // guards the ON CONFLICT upsert path in write_sync_tombstone
    const catId = '01CATAAAAAAAAAAAAAAAAAAAA2';
    await db.tenants.forStore(A.store).tx(async (tx) => {
      await tx.insert(categories).values({ id: catId, storeId: A.store, name: 'Twice' });
      await tx.delete(categories).where(eq(categories.id, catId));
      await tx.insert(categories).values({ id: catId, storeId: A.store, name: 'Twice again' });
      await tx.delete(categories).where(eq(categories.id, catId));
    });
    const page = await syncService.changes(ctx, 0, 500);
    const tombstones = page.changes.filter(
      (c) => c.type === 'tombstone' && c.data['entity_id'] === catId,
    );
    expect(tombstones).toHaveLength(1);
  });

  it('paginates with next_since covering the same set exactly once', async () => {
    const all = await syncService.changes(ctx, 0, 500);
    const seen: string[] = [];
    let since = 0;
    let pages = 0;
    for (;;) {
      const page = await syncService.changes(ctx, since, 3);
      expect(page.changes.length).toBeLessThanOrEqual(3);
      seen.push(...page.changes.map((c) => `${c.type}:${String(c.data['id'] ?? c.data['entity_id'])}:${c.rev}`));
      pages += 1;
      if (!page.has_more) break;
      since = page.next_since;
    }
    expect(pages).toBeGreaterThan(1);
    const full = all.changes.map((c) => `${c.type}:${String(c.data['id'] ?? c.data['entity_id'])}:${c.rev}`);
    expect(seen).toEqual(full);
  });
});

describe('SyncService.ingestBatch', () => {
  let seq = 0;
  const nextUlid = (prefix: string) =>
    `${prefix}${String(++seq).padStart(26 - prefix.length, '0')}`;

  /** Build an order.completed fact whose totals really come from the domain math. */
  const makeOrderFact = (opts?: { totalDelta?: number; rateId?: string }) => {
    const orderId = nextUlid('01ORD');
    const lineId = nextUlid('01LIN');
    const rateId = opts?.rateId ?? A.taxRate;
    const cart = calculateCart({
      currency: 'SGD',
      priceMode: 'tax_inclusive',
      lines: [
        {
          id: lineId,
          unitPriceAmount: 250,
          qty: 2,
          taxRates: [{ id: A.taxRate, rateBp: 900 }],
        },
      ],
    });
    const line = cart.lines[0];
    if (!line) throw new Error('cart math returned no lines');
    return {
      type: 'order.completed' as const,
      order: {
        id: orderId,
        number: `R1-${String(seq).padStart(6, '0')}`,
        staff_id: A.staff,
        lines: [
          {
            id: lineId,
            variant_id: A.variant,
            name: 'Kopi',
            qty: 2,
            unit_price: { amount: 250, currency: 'SGD' },
            discounts: [],
            tax_lines: line.taxLines.map((t) => ({ rate_id: rateId, amount: t.amount })),
            total_amount: line.totalAmount,
          },
        ],
        totals: {
          subtotal: cart.subtotalAmount,
          discount: cart.discountAmount,
          tax: cart.taxAmount,
          total: cart.totalAmount + (opts?.totalDelta ?? 0),
        },
        tax_lines: line.taxLines.map((t) => ({ rate_id: rateId, amount: t.amount })),
        payments: [
          {
            id: nextUlid('01PAY'),
            tender: 'cash' as const,
            amount: cart.totalAmount + (opts?.totalDelta ?? 0),
            change: 0,
          },
        ],
        client_created_at: '2026-07-11T03:21:44.000Z',
        local_seq: seq,
      },
    };
  };

  const makeMovementFact = (orderId: string, qtyDelta = -2) => ({
    type: 'stock.movement' as const,
    movement: {
      id: nextUlid('01MOV'),
      variant_id: A.variant,
      location_id: A.location,
      qty_delta: qtyDelta,
      movement_type: 'sale' as const,
      ref_order_id: orderId,
    },
  });

  const makeBatch = (facts: SyncBatchInput['facts']): SyncBatchInput => ({
    batch_id: nextUlid('01BAT'),
    client: { register_id: A.register, app_version: '0.1.0' },
    facts,
  });

  const counts = async () =>
    db.tenants.forStore(A.store).tx(async (tx) => ({
      orders: (await tx.select().from(orders)).length,
      lines: (await tx.select().from(orderLines)).length,
      payments: (await tx.select().from(payments)).length,
      movements: (await tx.select().from(stockMovements)).length,
      conflicts: (await tx.select().from(syncConflicts)).length,
    }));

  it('accepts a happy-path sale and projects inventory', async () => {
    const before = await counts();
    const onHandBefore = await db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, A.variant)))[0]
        ?.onHand,
    );
    const orderFact = makeOrderFact();
    const movementFact = makeMovementFact(orderFact.order.id);
    const batch = makeBatch([orderFact, movementFact]);

    const result = await syncService.ingestBatch(ctx, batch);
    expect(result.acks).toEqual([
      { id: orderFact.order.id, status: 'accepted' },
      { id: movementFact.movement.id, status: 'accepted' },
    ]);
    expect(result.server_rev).toBeGreaterThan(0);

    const after = await counts();
    expect(after.orders).toBe(before.orders + 1);
    expect(after.lines).toBe(before.lines + 1);
    expect(after.payments).toBe(before.payments + 1);
    expect(after.movements).toBe(before.movements + 1);
    expect(after.conflicts).toBe(before.conflicts);

    const rows = await db.tenants.forStore(A.store).tx(async (tx) => ({
      order: (await tx.select().from(orders).where(eq(orders.id, orderFact.order.id)))[0],
      movement: (await tx.select().from(stockMovements).where(eq(stockMovements.id, movementFact.movement.id)))[0],
      level: (await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, A.variant)))[0],
    }));
    expect(rows.order).toMatchObject({
      registerId: A.register,
      locationId: A.location,
      state: 'completed',
      currency: 'SGD',
      totalAmount: orderFact.order.totals.total,
      localSeq: orderFact.order.local_seq,
    });
    expect(rows.movement).toMatchObject({ refType: 'order', refId: orderFact.order.id });
    expect(rows.level?.onHand).toBe(Number(onHandBefore) - 2);
  });

  it('replays an identical batch verbatim without re-applying', async () => {
    const orderFact = makeOrderFact();
    const batch = makeBatch([orderFact, makeMovementFact(orderFact.order.id)]);
    const first = await syncService.ingestBatch(ctx, batch);
    const before = await counts();
    const replay = await syncService.ingestBatch(ctx, batch);
    expect(replay.acks).toEqual(first.acks);
    expect(await counts()).toEqual(before);
  });

  it('dedupes a fact resent in a NEW batch', async () => {
    const orderFact = makeOrderFact();
    await syncService.ingestBatch(ctx, makeBatch([orderFact]));
    const before = await counts();
    const result = await syncService.ingestBatch(ctx, makeBatch([orderFact]));
    expect(result.acks).toEqual([{ id: orderFact.order.id, status: 'duplicate' }]);
    expect(await counts()).toEqual(before);
  });

  it('accepts a total mismatch but logs a total_mismatch conflict (golden rule)', async () => {
    const orderFact = makeOrderFact({ totalDelta: 10 });
    const result = await syncService.ingestBatch(ctx, makeBatch([orderFact]));
    expect(result.acks[0]).toMatchObject({
      id: orderFact.order.id,
      status: 'accepted_with_conflict',
      conflict: { type: 'total_mismatch' },
    });
    const rows = await db.tenants.forStore(A.store).tx(async (tx) => ({
      order: (await tx.select().from(orders).where(eq(orders.id, orderFact.order.id)))[0],
      conflict: (await tx.select().from(syncConflicts)).filter(
        (c) => c.entityId === orderFact.order.id,
      ),
    }));
    // the client's charged totals persist verbatim — reality wins
    expect(rows.order?.totalAmount).toBe(orderFact.order.totals.total);
    expect(rows.conflict).toHaveLength(1);
    expect(rows.conflict[0]).toMatchObject({ conflictType: 'total_mismatch', entityType: 'order' });
    const details = rows.conflict[0]?.details as { client_totals?: unknown; server_totals?: unknown };
    expect(details.client_totals).toBeDefined();
    expect(details.server_totals).toBeDefined();
  });

  it('flags an unknown tax rate as stale_reference and skips revalidation', async () => {
    const orderFact = makeOrderFact({ rateId: '01TAXRGONEAAAAAAAAAAAAAAA1' });
    const result = await syncService.ingestBatch(ctx, makeBatch([orderFact]));
    expect(result.acks[0]).toMatchObject({
      id: orderFact.order.id,
      status: 'accepted_with_conflict',
      conflict: { type: 'stale_reference' },
    });
  });

  it('a replayed batch never double-logs conflicts', async () => {
    const orderFact = makeOrderFact({ totalDelta: 25 });
    const batch = makeBatch([orderFact]);
    await syncService.ingestBatch(ctx, batch);
    const before = await counts();
    await syncService.ingestBatch(ctx, batch); // stored-acks replay
    await syncService.ingestBatch(ctx, makeBatch([orderFact])); // per-fact dedupe
    expect((await counts()).conflicts).toBe(before.conflicts);
  });

  it('rejects the whole batch atomically when one fact is unpersistable', async () => {
    const orderFact = makeOrderFact();
    const badMovement = {
      type: 'stock.movement' as const,
      movement: {
        id: nextUlid('01MOV'),
        variant_id: '01VARGONEAAAAAAAAAAAAAAAA1', // FK violation
        location_id: A.location,
        qty_delta: -1,
        movement_type: 'sale' as const,
        ref_order_id: orderFact.order.id,
      },
    };
    const batchId = nextUlid('01BAT');
    const before = await counts();
    await expect(
      syncService.ingestBatch(ctx, { batch_id: batchId, client: { register_id: A.register }, facts: [orderFact, badMovement] }),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before); // first fact rolled back too

    // fixed retry with the SAME idempotency key succeeds
    const retry = await syncService.ingestBatch(ctx, {
      batch_id: batchId,
      client: { register_id: A.register },
      facts: [orderFact, makeMovementFact(orderFact.order.id)],
    });
    expect(retry.acks.map((a) => a.status)).toEqual(['accepted', 'accepted']);
  });

  // ---- refunds (1C) ---------------------------------------------------------

  /** Refund `qty` units of an already-ingested order's single line. */
  const makeRefundFact = (
    orderFact: ReturnType<typeof makeOrderFact>,
    qty: number,
    restock = true,
  ) => {
    const line = orderFact.order.lines[0];
    if (!line) throw new Error('order fact has no line');
    const amount = Math.round((line.total_amount * qty) / line.qty);
    const tax = Math.round(
      (line.tax_lines.reduce((sum, t) => sum + t.amount, 0) * qty) / line.qty,
    );
    return {
      type: 'refund.completed' as const,
      refund: {
        id: nextUlid('01REF'),
        order_id: orderFact.order.id,
        staff_id: A.staff,
        approved_by: A.staff,
        currency: 'SGD',
        total_amount: amount,
        tax_amount: tax,
        tax_lines: line.tax_lines.map((t) => ({ rate_id: t.rate_id, amount: tax })),
        tender: 'cash' as const,
        lines: [
          {
            id: nextUlid('01RFL'),
            order_line_id: line.id,
            variant_id: A.variant,
            qty,
            amount,
            restock,
          },
        ],
        client_created_at: '2026-07-12T03:00:00.000Z',
        local_seq: seq,
      },
    };
  };

  const ingestSale = async () => {
    const orderFact = makeOrderFact();
    await syncService.ingestBatch(ctx, makeBatch([orderFact, makeMovementFact(orderFact.order.id)]));
    return orderFact;
  };

  const orderState = async (orderId: string) =>
    db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select({ state: orders.state }).from(orders).where(eq(orders.id, orderId)))[0]?.state,
    );

  it('partial refund records refund rows, restocks, and sets partially_refunded', async () => {
    const orderFact = await ingestSale();
    const onHandBefore = await db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, A.variant)))[0]?.onHand,
    );
    const refundFact = makeRefundFact(orderFact, 1, true);
    const restock = {
      type: 'stock.movement' as const,
      movement: {
        id: nextUlid('01MOV'),
        variant_id: A.variant,
        location_id: A.location,
        qty_delta: 1,
        movement_type: 'refund_restock' as const,
        ref_order_id: orderFact.order.id,
      },
    };

    const result = await syncService.ingestBatch(ctx, makeBatch([refundFact, restock]));
    expect(result.acks.map((a) => a.status)).toEqual(['accepted', 'accepted']);

    const rows = await db.tenants.forStore(A.store).tx(async (tx) => ({
      refund: (await tx.select().from(refunds).where(eq(refunds.id, refundFact.refund.id)))[0],
      lines: await tx.select().from(refundLines).where(eq(refundLines.refundId, refundFact.refund.id)),
      level: (await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, A.variant)))[0],
    }));
    expect(rows.refund).toMatchObject({ orderId: orderFact.order.id, tenderType: 'cash', approvedBy: A.staff });
    expect(rows.lines).toHaveLength(1);
    expect(rows.level?.onHand).toBe(Number(onHandBefore) + 1); // restocked
    expect(await orderState(orderFact.order.id)).toBe('partially_refunded');
  });

  it('refunding every unit sets the order to refunded', async () => {
    const orderFact = await ingestSale();
    const refundFact = makeRefundFact(orderFact, 2, false);
    await syncService.ingestBatch(ctx, makeBatch([refundFact]));
    expect(await orderState(orderFact.order.id)).toBe('refunded');
  });

  it('replays a refund batch idempotently', async () => {
    const orderFact = await ingestSale();
    const refundFact = makeRefundFact(orderFact, 1, false);
    const batch = makeBatch([refundFact]);
    const first = await syncService.ingestBatch(ctx, batch);
    const replay = await syncService.ingestBatch(ctx, batch);
    expect(first.acks).toEqual(replay.acks);
    const count = await db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select().from(refunds).where(eq(refunds.orderId, orderFact.order.id))).length,
    );
    expect(count).toBe(1); // not double-applied
  });

  it('rolls back a refund against an order the server has not seen (FK)', async () => {
    const ghost = makeOrderFact(); // built but never ingested
    const refundFact = makeRefundFact(ghost, 1, false);
    await expect(syncService.ingestBatch(ctx, makeBatch([refundFact]))).rejects.toThrow();
    const stored = await db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select().from(refunds).where(eq(refunds.id, refundFact.refund.id)))[0],
    );
    expect(stored).toBeUndefined(); // batch rolled back atomically
  });
});
