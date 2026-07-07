import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateCart, calculateLineTax, sumTax, type CartInput } from '../src/index.js';

const VAT12 = { id: 'ph-vat-12', rateBp: 1200 };

describe('cart calculator edge behavior (beyond goldens)', () => {
  it('rejects negative prices, quantities, and discount values', () => {
    expect(() =>
      calculateCart({
        currency: 'PHP',
        priceMode: 'tax_inclusive',
        lines: [{ id: 'l1', unitPriceAmount: -100, qty: 1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateCart({
        currency: 'PHP',
        priceMode: 'tax_inclusive',
        lines: [{ id: 'l1', unitPriceAmount: 100, qty: -1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateCart({
        currency: 'PHP',
        priceMode: 'tax_inclusive',
        lines: [
          { id: 'l1', unitPriceAmount: 100, qty: 1, discounts: [{ type: 'fixed', value: -5 }] },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      calculateCart({
        currency: 'PHP',
        priceMode: 'tax_inclusive',
        lines: [{ id: 'l1', unitPriceAmount: 100, qty: 1 }],
        discounts: [{ type: 'percent', value: -100 }],
      }),
    ).toThrow(RangeError);
  });

  it('skips cart discounts against an all-zero cart', () => {
    const totals = calculateCart({
      currency: 'PHP',
      priceMode: 'tax_inclusive',
      lines: [{ id: 'l1', unitPriceAmount: 0, qty: 5, taxRates: [VAT12] }],
      discounts: [{ type: 'fixed', value: 1000 }],
    });
    expect(totals.totalAmount).toBe(0);
    expect(totals.discountAmount).toBe(0);
  });

  it('rejects rates below zero', () => {
    expect(() => calculateLineTax(1000, [{ id: 'bad', rateBp: -100 }], 'tax_exclusive')).toThrow(
      RangeError,
    );
  });

  it('sumTax adds tax line amounts', () => {
    expect(sumTax([{ rateId: 'a', rateBp: 1200, amount: 12 }])).toBe(12);
    expect(sumTax([])).toBe(0);
  });
});

describe('cart invariants (property)', () => {
  const lineArb = fc.record({
    id: fc.uuid(),
    unitPriceAmount: fc.integer({ min: 0, max: 10_000_000 }),
    qty: fc.integer({ min: 0, max: 100 }),
    discounts: fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant('percent' as const),
          value: fc.integer({ min: 0, max: 10_000 }),
        }),
        fc.record({
          type: fc.constant('fixed' as const),
          value: fc.integer({ min: 0, max: 1_000_000 }),
        }),
      ),
      { maxLength: 3 },
    ),
    taxRates: fc.array(
      fc.record({ id: fc.constant('vat'), rateBp: fc.integer({ min: 0, max: 3_000 }) }),
      { maxLength: 2 },
    ),
  });

  const cartArb = fc.record({
    currency: fc.constant('PHP'),
    priceMode: fc.constantFrom('tax_inclusive' as const, 'tax_exclusive' as const),
    lines: fc.array(lineArb, { maxLength: 8 }),
    discounts: fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant('percent' as const),
          value: fc.integer({ min: 0, max: 10_000 }),
        }),
        fc.record({
          type: fc.constant('fixed' as const),
          value: fc.integer({ min: 0, max: 10_000_000 }),
        }),
      ),
      { maxLength: 3 },
    ),
  }) satisfies fc.Arbitrary<CartInput>;

  it('never loses cents: subtotal - discounts == Σ net; totals are consistent', () => {
    fc.assert(
      fc.property(cartArb, (input) => {
        const t = calculateCart(input);
        const netSum = t.lines.reduce((s, l) => s + l.netAmount, 0);
        const grossSum = t.lines.reduce((s, l) => s + l.grossAmount, 0);
        const expectedTotal = input.priceMode === 'tax_exclusive' ? netSum + t.taxAmount : netSum;
        return (
          grossSum === t.subtotalAmount &&
          t.subtotalAmount - t.discountAmount === netSum &&
          t.totalAmount === expectedTotal &&
          t.lines.every((l) => l.netAmount >= 0) &&
          [t.subtotalAmount, t.discountAmount, t.taxAmount, t.totalAmount].every(
            Number.isSafeInteger,
          )
        );
      }),
    );
  });

  it('order total equals Σ line totals (invariant 1, data-model.md)', () => {
    fc.assert(
      fc.property(cartArb, (input) => {
        const t = calculateCart(input);
        return t.totalAmount === t.lines.reduce((s, l) => s + l.totalAmount, 0);
      }),
    );
  });
});
