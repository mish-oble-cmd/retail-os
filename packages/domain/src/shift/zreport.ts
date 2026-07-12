/**
 * Z-report aggregation (FR-6.2). Folds a shift's orders, refunds, and cash
 * movements into an immutable snapshot the cashier prints at close and the
 * server stores verbatim. Pure integer minor units, zero I/O.
 */
import { calculateExpectedCash, calculateOverShort } from './cash.js';

export type Tender = 'cash' | 'card_manual';

export interface ZReportOrder {
  staffId: string | null;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  payments: Array<{ tender: Tender; amount: number }>;
}

export interface ZReportRefund {
  tender: Tender;
  amount: number;
}

export interface ZReportMovement {
  kind: 'paid_in' | 'paid_out' | 'no_sale';
  amount: number;
}

export interface ZReportInput {
  orders: ZReportOrder[];
  refunds: ZReportRefund[];
  movements: ZReportMovement[];
  openingFloat: number;
  countedCash: number;
}

export interface ZStaffLine {
  staffId: string;
  netSales: number;
  txnCount: number;
}

export interface ZSnapshot {
  grossSales: number;
  netSales: number;
  taxCollected: number;
  discounts: number;
  refunds: number;
  txnCount: number;
  tenders: { cash: number; card_manual: number };
  cashRefunds: number;
  byStaff: ZStaffLine[];
  openingFloat: number;
  paidIn: number;
  paidOut: number;
  expectedCash: number;
  countedCash: number;
  overShort: number;
}

/** Builds the Z-report snapshot for a shift (FR-6.2). */
export function buildZReport(input: ZReportInput): ZSnapshot {
  const tenders = { cash: 0, card_manual: 0 };
  let grossSales = 0;
  let taxCollected = 0;
  let discounts = 0;

  const staffOrder: string[] = [];
  const staffAgg = new Map<string, ZStaffLine>();

  for (const o of input.orders) {
    grossSales += o.total;
    taxCollected += o.tax;
    discounts += o.discount;
    for (const p of o.payments) tenders[p.tender] += p.amount;

    const key = o.staffId ?? 'unattributed';
    let agg = staffAgg.get(key);
    if (!agg) {
      agg = { staffId: key, netSales: 0, txnCount: 0 };
      staffAgg.set(key, agg);
      staffOrder.push(key);
    }
    agg.netSales += o.total - o.tax;
    agg.txnCount += 1;
  }

  const netSales = grossSales - taxCollected;
  const refunds = input.refunds.reduce((s, r) => s + r.amount, 0);
  const cashRefunds = input.refunds
    .filter((r) => r.tender === 'cash')
    .reduce((s, r) => s + r.amount, 0);
  const paidIn = input.movements
    .filter((m) => m.kind === 'paid_in')
    .reduce((s, m) => s + m.amount, 0);
  const paidOut = input.movements
    .filter((m) => m.kind === 'paid_out')
    .reduce((s, m) => s + m.amount, 0);

  const expectedCash = calculateExpectedCash({
    openingFloat: input.openingFloat,
    cashSales: tenders.cash,
    cashRefunds,
    paidIn,
    paidOut,
  });

  return {
    grossSales,
    netSales,
    taxCollected,
    discounts,
    refunds,
    txnCount: input.orders.length,
    tenders,
    cashRefunds,
    byStaff: staffOrder.map((k) => staffAgg.get(k)!),
    openingFloat: input.openingFloat,
    paidIn,
    paidOut,
    expectedCash,
    countedCash: input.countedCash,
    overShort: calculateOverShort(input.countedCash, expectedCash),
  };
}
