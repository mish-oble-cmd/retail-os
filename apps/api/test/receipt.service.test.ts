/**
 * Public web receipt (1C): resolves the store from the order ULID cross-tenant,
 * then reads the receipt inside that store's RLS context.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { locations, orderLines, orders, payments, registers, roles, staff, stores } from '../src/db/schema';
import { ReceiptService } from '../src/modules/orders/receipt.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let service: ReceiptService;
const sent: { to: string; subject: string }[] = [];

const S = {
  store: '01STORERCPTAAAAAAAAAAAAAAA',
  role: '01ROLERCPTAAAAAAAAAAAAAAAA',
  staff: '01STAFFRCPTAAAAAAAAAAAAAAA',
  loc: '01LOCRCPTAAAAAAAAAAAAAAAA1',
  reg: '01REGRCPTAAAAAAAAAAAAAAAA1',
  order: '01ORDERRCPTAAAAAAAAAAAAAAA',
  line: '01LINERCPTAAAAAAAAAAAAAAAA',
  pay: '01PAYRCPTAAAAAAAAAAAAAAAA1',
};

beforeAll(async () => {
  db = await createTestDb();
  const mailer = { send: async (m: { to: string; subject: string }) => void sent.push(m) };
  service = new ReceiptService(db as unknown as DbService, mailer as never);

  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values({ id: S.store, name: 'Bahay Kubo', currency: 'PHP', timezone: 'Asia/Manila' });
    await tx.insert(roles).values({ id: S.role, storeId: S.store, name: 'Owner', permissions: { owner: true } });
    await tx.insert(staff).values({
      id: S.staff,
      storeId: S.store,
      name: 'Ana',
      roleId: S.role,
      passwordHash: 'x',
      totpSecret: 'y',
    });
    await tx.insert(locations).values({ id: S.loc, storeId: S.store, name: 'Main' });
    await tx.insert(registers).values({ id: S.reg, storeId: S.store, locationId: S.loc, name: 'R2', gridLayout: {} });
    await tx.insert(orders).values({
      id: S.order,
      storeId: S.store,
      registerId: S.reg,
      locationId: S.loc,
      staffId: S.staff,
      number: 'R2-0001',
      state: 'completed',
      currency: 'PHP',
      subtotalAmount: 32000,
      discountAmount: 0,
      taxAmount: 3429,
      totalAmount: 32000,
      taxLines: [{ rate_id: 'r', amount: 3429 }],
    });
    await tx.insert(orderLines).values({
      id: S.line,
      storeId: S.store,
      orderId: S.order,
      name: 'Barako Coffee',
      qty: 1,
      unitPriceAmount: 32000,
      totalAmount: 32000,
    });
    await tx.insert(payments).values({
      id: S.pay,
      storeId: S.store,
      orderId: S.order,
      tenderType: 'cash',
      amount: 32000,
      changeAmount: 18000,
    });
  });
});

afterAll(async () => {
  await db.close();
});

describe('ReceiptService', () => {
  it('returns the receipt view resolved from the order ULID', async () => {
    const receipt = await service.getReceipt(S.order);
    expect(receipt.store.name).toBe('Bahay Kubo');
    expect(receipt.cashier).toBe('Ana');
    expect(receipt.order.number).toBe('R2-0001');
    expect(receipt.lines).toEqual([{ name: 'Barako Coffee', qty: 1, total_amount: 32000 }]);
    expect(receipt.payments[0]).toMatchObject({ tender_type: 'cash', amount: 32000, change_amount: 18000 });
  });

  it('throws for an unknown order', async () => {
    await expect(service.getReceipt('01ZZZRCPTAAAAAAAAAAAAAAAAA')).rejects.toThrow();
  });

  it('renders and sends an email receipt', async () => {
    await service.emailReceipt(S.order, 'buyer@example.com');
    expect(sent.at(-1)).toMatchObject({ to: 'buyer@example.com' });
    expect(sent.at(-1)?.subject).toContain('R2-0001');
  });
});
