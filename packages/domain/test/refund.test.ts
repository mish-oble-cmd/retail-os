import { describe, expect, it } from 'vitest';
import { calculateRefund, formatSaleNumber, type RefundableLine } from '../src/index.js';

// A tax-exclusive line: 3 × ₱10.00, 12% VAT → total 3360 (net 3000 + tax 360).
const line = (over: Partial<RefundableLine> = {}): RefundableLine => ({
  id: 'l1',
  variantId: 'v1',
  name: 'Kopiko',
  qty: 3,
  unitPriceAmount: 1000,
  totalAmount: 3360,
  taxLines: [{ rateId: 'vat12', amount: 360 }],
  ...over,
});

describe('calculateRefund', () => {
  it('refunds a full line exactly — total and tax preserved', () => {
    const r = calculateRefund({
      currency: 'PHP',
      lines: [line()],
      selections: [{ lineId: 'l1', qty: 3, restock: true }],
    });
    expect(r.totalAmount).toBe(3360);
    expect(r.taxAmount).toBe(360);
    expect(r.lines[0]?.qty).toBe(3);
    expect(r.restock).toEqual([{ variantId: 'v1', qty: 3 }]);
  });

  it('scales a partial-quantity refund proportionally (half away from zero)', () => {
    const r = calculateRefund({
      currency: 'PHP',
      lines: [line()],
      selections: [{ lineId: 'l1', qty: 1, restock: false }],
    });
    // 3360 × 1/3 = 1120; 360 × 1/3 = 120
    expect(r.totalAmount).toBe(1120);
    expect(r.taxAmount).toBe(120);
    expect(r.restock).toEqual([]); // no restock selected
  });

  it('accounts for units already refunded when clamping', () => {
    const r = calculateRefund({
      currency: 'PHP',
      lines: [line({ refundedQty: 2 })],
      selections: [{ lineId: 'l1', qty: 1, restock: true }],
    });
    expect(r.lines[0]?.qty).toBe(1);
    expect(() =>
      calculateRefund({
        currency: 'PHP',
        lines: [line({ refundedQty: 2 })],
        selections: [{ lineId: 'l1', qty: 2, restock: true }],
      }),
    ).toThrow(/remaining/);
  });

  it('rejects over-refund, negative qty, and unknown lines', () => {
    expect(() =>
      calculateRefund({
        currency: 'PHP',
        lines: [line()],
        selections: [{ lineId: 'l1', qty: 4, restock: false }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateRefund({
        currency: 'PHP',
        lines: [line()],
        selections: [{ lineId: 'l1', qty: -1, restock: false }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateRefund({
        currency: 'PHP',
        lines: [line()],
        selections: [{ lineId: 'nope', qty: 1, restock: false }],
      }),
    ).toThrow(/unknown line/);
  });

  it('merges restock across multiple lines of the same variant, ignores zero-qty', () => {
    const r = calculateRefund({
      currency: 'PHP',
      lines: [line({ id: 'l1' }), line({ id: 'l2' })],
      selections: [
        { lineId: 'l1', qty: 2, restock: true },
        { lineId: 'l2', qty: 1, restock: true },
        { lineId: 'l1', qty: 0, restock: true }, // skipped
      ],
    });
    expect(r.restock).toEqual([{ variantId: 'v1', qty: 3 }]);
  });

  it('omits restock for lines without a variant (e.g. custom sale)', () => {
    const r = calculateRefund({
      currency: 'PHP',
      lines: [line({ variantId: null })],
      selections: [{ lineId: 'l1', qty: 3, restock: true }],
    });
    expect(r.restock).toEqual([]);
  });
});

describe('formatSaleNumber', () => {
  it('zero-pads and applies an optional register prefix', () => {
    expect(formatSaleNumber(42)).toBe('0042');
    expect(formatSaleNumber(42, { prefix: 'R2' })).toBe('R2-0042');
    expect(formatSaleNumber(12345, { prefix: 'R2' })).toBe('R2-12345');
    expect(formatSaleNumber(7, { padTo: 6 })).toBe('000007');
  });

  it('rejects negative sequence numbers', () => {
    expect(() => formatSaleNumber(-1)).toThrow(RangeError);
  });
});
