import { describe, it, expect } from 'vitest';
import { buildZReport } from '../src/index.js';

const order = (
  staffId: string,
  tender: 'cash' | 'card_manual',
  total: number,
  tax = 0,
  discount = 0,
) => ({
  staffId,
  subtotal: total - tax,
  discount,
  tax,
  total,
  payments: [{ tender, amount: total }],
});

describe('buildZReport', () => {
  it('aggregates gross/net/tax/discounts/tenders/per-staff and reconciles cash', () => {
    const z = buildZReport({
      orders: [
        order('ana', 'cash', 1000, 100, 0),
        order('ben', 'card_manual', 2000, 200, 0),
        order('ana', 'cash', 500, 50, 50),
      ],
      refunds: [{ tender: 'cash', amount: 165 }],
      movements: [
        { kind: 'paid_out', amount: 500 },
        { kind: 'paid_in', amount: 0 },
        { kind: 'no_sale', amount: 0 },
      ],
      openingFloat: 200000,
      countedCash: 200000 + 1500 - 165 - 500,
    });

    expect(z.grossSales).toBe(3500);
    expect(z.taxCollected).toBe(350);
    expect(z.netSales).toBe(3150);
    expect(z.discounts).toBe(50);
    expect(z.refunds).toBe(165);
    expect(z.txnCount).toBe(3);
    expect(z.tenders).toEqual({ cash: 1500, card_manual: 2000 });
    expect(z.cashRefunds).toBe(165);
    expect(z.paidOut).toBe(500);
    expect(z.paidIn).toBe(0);
    expect(z.byStaff).toEqual([
      { staffId: 'ana', netSales: 1350, txnCount: 2 },
      { staffId: 'ben', netSales: 1800, txnCount: 1 },
    ]);
    expect(z.expectedCash).toBe(200835); // 200000 + 1500 − 165 − 500
    expect(z.overShort).toBe(0);
  });

  it('folds split-tender payments into the tender breakdown', () => {
    const z = buildZReport({
      orders: [
        {
          staffId: 'ana',
          subtotal: 1000,
          discount: 0,
          tax: 0,
          total: 1000,
          payments: [
            { tender: 'cash', amount: 600 },
            { tender: 'card_manual', amount: 400 },
          ],
        },
      ],
      refunds: [],
      movements: [],
      openingFloat: 0,
      countedCash: 600,
    });
    expect(z.tenders).toEqual({ cash: 600, card_manual: 400 });
    expect(z.expectedCash).toBe(600);
    expect(z.overShort).toBe(0);
  });

  it('buckets unattributed orders under a stable key', () => {
    const z = buildZReport({
      orders: [{ ...order('x', 'cash', 100), staffId: null }],
      refunds: [],
      movements: [],
      openingFloat: 0,
      countedCash: 100,
    });
    expect(z.byStaff).toEqual([{ staffId: 'unattributed', netSales: 100, txnCount: 1 }]);
  });
});
