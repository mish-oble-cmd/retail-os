/**
 * Shift + cash-movement ingest (1D): shift.opened / cash.movement / shift.closed
 * facts land under RLS, orders carry shift_id, and a close for an unknown shift
 * rolls the batch back (retry posture, like a refund waiting for its order).
 */
import { calculateCart } from '@retailos/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import {
  cashMovements,
  categories,
  inventoryLevels,
  locations,
  orders,
  products,
  registers,
  roles,
  shifts,
  staff,
  stores,
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
  store: '01STORESHIFTAAAAAAAAAAAAAA',
  role: '01ROLESHIFTAAAAAAAAAAAAAAA',
  staff: '01STAFFSHIFTAAAAAAAAAAAAAA',
  location: '01LOCSHIFTAAAAAAAAAAAAAAA1',
  register: '01REGSHIFTAAAAAAAAAAAAAAA1',
  taxCategory: '01TAXCSHIFTAAAAAAAAAAAAAA1',
  taxRate: '01TAXRSHIFTAAAAAAAAAAAAAA1',
  category: '01CATSHIFTAAAAAAAAAAAAAAA1',
  product: '01PRODSHIFTAAAAAAAAAAAAAA1',
  variant: '01VARSHIFTAAAAAAAAAAAAAAA1',
  level: '01LVLSHIFTAAAAAAAAAAAAAAA1',
};

const ctx: DeviceContext = {
  deviceId: '01DEVSHIFTAAAAAAAAAAAAAAA1',
  storeId: A.store,
  registerId: A.register,
  locationId: A.location,
};

let seq = 0;
const nextUlid = (prefix: string) => `${prefix}${String(++seq).padStart(26 - prefix.length, '0')}`;

const makeBatch = (facts: SyncBatchInput['facts']): SyncBatchInput => ({
  batch_id: nextUlid('01BAT'),
  client: { register_id: A.register, app_version: '0.1.0' },
  facts,
});

const SHIFT = '01SHIFTAAAAAAAAAAAAAAAAAA1';

beforeAll(async () => {
  db = await createTestDb();
  syncService = new SyncService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values({ id: A.store, name: 'Store A', currency: 'PHP' });
    await tx.insert(roles).values({ id: A.role, storeId: A.store, name: 'Owner', permissions: { owner: true } });
    await tx.insert(staff).values({
      id: A.staff,
      storeId: A.store,
      name: 'Ana',
      roleId: A.role,
      passwordHash: 'argon2id$SECRET',
      pinHash: 'argon2id$pin',
      totpSecret: 'TOTP',
    });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
    await tx.insert(registers).values({
      id: A.register,
      storeId: A.store,
      locationId: A.location,
      name: 'Front',
      gridLayout: { tiles: [] },
    });
    await tx.insert(taxCategories).values({ id: A.taxCategory, storeId: A.store, name: 'Standard' });
    await tx.insert(taxRates).values({
      id: A.taxRate,
      storeId: A.store,
      taxCategoryId: A.taxCategory,
      name: 'VAT 12%',
      rateBp: 1200,
    });
    await tx.insert(categories).values({ id: A.category, storeId: A.store, name: 'Food' });
    await tx.insert(products).values({
      id: A.product,
      storeId: A.store,
      name: 'Turon',
      categoryId: A.category,
      taxCategoryId: A.taxCategory,
      status: 'active',
    });
    await tx.insert(variants).values({ id: A.variant, storeId: A.store, productId: A.product, priceAmount: 1500 });
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

describe('shift ingest', () => {
  it('opens a shift', async () => {
    const res = await syncService.ingestBatch(
      ctx,
      makeBatch([
        {
          type: 'shift.opened',
          shift: {
            id: SHIFT,
            register_id: A.register,
            location_id: A.location,
            opened_by_staff_id: A.staff,
            opened_at: '2026-07-12T00:02:00.000Z',
            opening_float: 200000,
          },
        },
      ]),
    );
    expect(res.acks[0]).toMatchObject({ id: SHIFT, status: 'accepted' });
    const row = await db.tenants
      .forStore(A.store)
      .tx(async (tx) => (await tx.select().from(shifts).where(eq(shifts.id, SHIFT)))[0]);
    expect(row?.state).toBe('open');
    expect(row?.openingFloat).toBe(200000);
  });

  it('stamps shift_id on an order rung during the shift', async () => {
    const orderId = nextUlid('01ORD');
    const lineId = nextUlid('01LIN');
    const cart = calculateCart({
      currency: 'PHP',
      priceMode: 'tax_inclusive',
      lines: [{ id: lineId, unitPriceAmount: 1500, qty: 1, taxRates: [{ id: A.taxRate, rateBp: 1200 }] }],
    });
    const line = cart.lines[0]!;
    await syncService.ingestBatch(
      ctx,
      makeBatch([
        {
          type: 'order.completed',
          order: {
            id: orderId,
            number: 'R1-000001',
            staff_id: A.staff,
            shift_id: SHIFT,
            lines: [
              {
                id: lineId,
                variant_id: A.variant,
                name: 'Turon',
                qty: 1,
                unit_price: { amount: 1500, currency: 'PHP' },
                discounts: [],
                tax_lines: line.taxLines.map((t) => ({ rate_id: A.taxRate, amount: t.amount })),
                total_amount: line.totalAmount,
              },
            ],
            totals: {
              subtotal: cart.subtotalAmount,
              discount: cart.discountAmount,
              tax: cart.taxAmount,
              total: cart.totalAmount,
            },
            tax_lines: line.taxLines.map((t) => ({ rate_id: A.taxRate, amount: t.amount })),
            payments: [{ id: nextUlid('01PAY'), tender: 'cash', amount: cart.totalAmount, change: 0 }],
            client_created_at: '2026-07-12T01:00:00.000Z',
            local_seq: seq,
          },
        },
      ]),
    );
    const row = await db.tenants
      .forStore(A.store)
      .tx(async (tx) => (await tx.select().from(orders).where(eq(orders.id, orderId)))[0]);
    expect(row?.shiftId).toBe(SHIFT);
  });

  it('records a paid-out cash movement', async () => {
    const movId = nextUlid('01CMV');
    const res = await syncService.ingestBatch(
      ctx,
      makeBatch([
        {
          type: 'cash.movement',
          movement: {
            id: movId,
            shift_id: SHIFT,
            kind: 'paid_out',
            amount: 50000,
            reason: 'LPG supplier COD',
            staff_id: A.staff,
            client_created_at: '2026-07-12T08:40:00.000Z',
          },
        },
      ]),
    );
    expect(res.acks[0]).toMatchObject({ status: 'accepted' });
    const row = await db.tenants
      .forStore(A.store)
      .tx(async (tx) => (await tx.select().from(cashMovements).where(eq(cashMovements.id, movId)))[0]);
    expect(row?.kind).toBe('paid_out');
    expect(row?.amount).toBe(50000);
  });

  it('closes the shift with over/short and a Z snapshot', async () => {
    const res = await syncService.ingestBatch(
      ctx,
      makeBatch([
        {
          type: 'shift.closed',
          shift: {
            id: SHIFT,
            closed_by_staff_id: A.staff,
            closed_at: '2026-07-12T12:14:00.000Z',
            closing_counted: 201380,
            closing_expected: 201500,
            over_short: -120,
            z: {
              grossSales: 1500,
              netSales: 1339,
              taxCollected: 161,
              discounts: 0,
              refunds: 0,
              txnCount: 1,
              tenders: { cash: 1500, card_manual: 0 },
              cashRefunds: 0,
              byStaff: [{ staffId: A.staff, netSales: 1339, txnCount: 1 }],
              openingFloat: 200000,
              paidIn: 0,
              paidOut: 50000,
              expectedCash: 201500,
              countedCash: 201380,
              overShort: -120,
            },
          },
        },
      ]),
    );
    expect(res.acks[0]).toMatchObject({ id: SHIFT, status: 'accepted' });
    const row = await db.tenants
      .forStore(A.store)
      .tx(async (tx) => (await tx.select().from(shifts).where(eq(shifts.id, SHIFT)))[0]);
    expect(row?.state).toBe('closed');
    expect(row?.overShort).toBe(-120);
    expect((row?.zSnapshot as { overShort: number }).overShort).toBe(-120);
  });

  it('rejects a close for an unknown shift (batch rolls back)', async () => {
    await expect(
      syncService.ingestBatch(
        ctx,
        makeBatch([
          {
            type: 'shift.closed',
            shift: {
              id: '01SHIFTGHOSTAAAAAAAAAAAAA1',
              closed_by_staff_id: A.staff,
              closed_at: '2026-07-12T12:14:00.000Z',
              closing_counted: 0,
              closing_expected: 0,
              over_short: 0,
              z: {
                grossSales: 0,
                netSales: 0,
                taxCollected: 0,
                discounts: 0,
                refunds: 0,
                txnCount: 0,
                tenders: { cash: 0, card_manual: 0 },
                cashRefunds: 0,
                byStaff: [],
                openingFloat: 0,
                paidIn: 0,
                paidOut: 0,
                expectedCash: 0,
                countedCash: 0,
                overShort: 0,
              },
            },
          },
        ]),
      ),
    ).rejects.toThrow(/unknown shift/);
  });
});
