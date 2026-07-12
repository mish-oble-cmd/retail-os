import type { CartTotals } from '@retailos/domain';
import type { LocalSaleInput, LocalSalePayment } from '@retailos/sync';
import { ulid } from 'ulid';
import type { CartLine } from './cart';

/**
 * Builds the LocalSaleInput fact from the finished cart + payments. Each fact
 * line carries a single fixed discount equal to (gross − net): that folds both
 * the line-level discount AND this line's allocated share of any cart-level
 * discount into one number, so the server's calculateCart revalidation (which
 * only sees line discounts) reproduces the client totals exactly — no
 * total_mismatch from cart-level discounts. Display/receipt read the richer
 * cart state; the fact only needs correct money.
 */
export function buildSaleInput(params: {
  lines: CartLine[];
  totals: CartTotals;
  currency: string;
  staffId: string;
  shiftId: string;
  locationId: string;
  seq: number;
  number: string;
  payments: LocalSalePayment[];
}): LocalSaleInput {
  const { lines, totals, currency, staffId, shiftId, locationId, seq, number, payments } = params;
  const orderId = ulid();

  const saleLines = lines.map((line, i) => {
    const lt = totals.lines[i]!;
    const gross = lt.grossAmount;
    const discount = gross - lt.netAmount;
    return {
      id: ulid(),
      variantId: line.variantId,
      name: line.name,
      qty: line.qty,
      unitPriceAmount: line.unitPriceAmount,
      discounts: discount > 0 ? [{ type: 'fixed' as const, value: discount }] : [],
      taxLines: lt.taxLines.map((t) => ({ rateId: t.rateId, amount: t.amount })),
      totalAmount: lt.totalAmount,
    };
  });

  // Aggregate per-line tax into order-level tax lines.
  const taxByRate = new Map<string, number>();
  for (const lt of totals.lines) {
    for (const t of lt.taxLines) taxByRate.set(t.rateId, (taxByRate.get(t.rateId) ?? 0) + t.amount);
  }
  const orderTaxLines = [...taxByRate].map(([rateId, amount]) => ({ rateId, amount }));

  const movements = lines
    .filter((line) => line.variantId)
    .map((line) => ({
      id: ulid(),
      variantId: line.variantId as string,
      locationId,
      qtyDelta: -line.qty,
      movementType: 'sale' as const,
    }));

  return {
    id: orderId,
    number,
    staffId,
    shiftId,
    currency,
    totals: {
      subtotal: totals.subtotalAmount,
      discount: totals.discountAmount,
      tax: totals.taxAmount,
      total: totals.totalAmount,
    },
    taxLines: orderTaxLines,
    lines: saleLines,
    payments,
    clientCreatedAt: new Date().toISOString(),
    localSeq: seq,
    movements,
  };
}
