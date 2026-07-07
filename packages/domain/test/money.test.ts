import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  allocateByWeights,
  applyBasisPoints,
  compare,
  divRoundHalfAwayFromZero,
  formatMoney,
  isZero,
  minorUnitDigits,
  money,
  multiply,
  negate,
  subtract,
} from '../src/index.js';

describe('money', () => {
  it('constructs and does integer arithmetic', () => {
    const a = money(49900, 'PHP');
    const b = money(100, 'PHP');
    expect(add(a, b)).toEqual(money(50000, 'PHP'));
    expect(subtract(a, b)).toEqual(money(49800, 'PHP'));
    expect(multiply(b, 3)).toEqual(money(300, 'PHP'));
    expect(negate(b)).toEqual(money(-100, 'PHP'));
    expect(isZero(money(0, 'PHP'))).toBe(true);
    expect(compare(a, b)).toBe(1);
    expect(compare(b, a)).toBe(-1);
    expect(compare(a, a)).toBe(0);
  });

  it('rejects floats and bad currency codes', () => {
    expect(() => money(1.5, 'PHP')).toThrow(RangeError);
    expect(() => money(100, 'php')).toThrow(RangeError);
    expect(() => money(100, 'PESO')).toThrow(RangeError);
    expect(() => add(money(1, 'PHP'), money(1, 'USD'))).toThrow(/currency mismatch/);
  });

  it('rejects non-integer multiply factors', () => {
    expect(() => multiply(money(100, 'PHP'), 1.5)).toThrow(RangeError);
  });
});

describe('formatMoney', () => {
  it('formats PHP for the Philippine locale', () => {
    expect(formatMoney(money(125000, 'PHP'), 'en-PH')).toBe('₱1,250.00');
    expect(formatMoney(money(1, 'PHP'), 'en-PH')).toBe('₱0.01');
    expect(formatMoney(money(-4500, 'PHP'), 'en-PH')).toBe('-₱45.00');
  });

  it('respects currency minor-unit digits', () => {
    expect(minorUnitDigits('PHP')).toBe(2);
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(formatMoney(money(1250, 'JPY'), 'en')).toBe('¥1,250');
  });
});

describe('divRoundHalfAwayFromZero', () => {
  it('rounds half away from zero in both directions', () => {
    expect(divRoundHalfAwayFromZero(25, 10)).toBe(3);
    expect(divRoundHalfAwayFromZero(-25, 10)).toBe(-3);
    expect(divRoundHalfAwayFromZero(24, 10)).toBe(2);
    expect(divRoundHalfAwayFromZero(-24, 10)).toBe(-2);
  });

  it('rejects zero/negative denominators and unsafe integers', () => {
    expect(() => divRoundHalfAwayFromZero(1, 0)).toThrow(RangeError);
    expect(() => divRoundHalfAwayFromZero(1, -10)).toThrow(RangeError);
    expect(() => divRoundHalfAwayFromZero(0.5, 10)).toThrow(RangeError);
  });

  it('mirror symmetry holds for all integers (refunds mirror sales)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 100_000 }),
        (n, d) => divRoundHalfAwayFromZero(-n, d) === -divRoundHalfAwayFromZero(n, d),
      ),
    );
  });
});

describe('applyBasisPoints', () => {
  it('computes 12% VAT', () => {
    expect(applyBasisPoints(10000, 1200)).toBe(1200);
    expect(applyBasisPoints(121, 1200)).toBe(15);
  });
});

describe('allocate (largest remainder)', () => {
  it('splits with no lost cents and ties to earlier index', () => {
    expect(allocateByWeights(100, [1000, 1000, 1000])).toEqual([34, 33, 33]);
    expect(allocate(money(101, 'PHP'), [1, 1]).map((m) => m.amount)).toEqual([51, 50]);
  });

  it('puts everything on the first slot when all weights are zero', () => {
    expect(allocateByWeights(55, [0, 0])).toEqual([55, 0]);
  });

  it('rejects empty weights and negative weights', () => {
    expect(() => allocateByWeights(10, [])).toThrow(RangeError);
    expect(() => allocateByWeights(10, [-1, 2])).toThrow(RangeError);
  });

  it('conserves the total for any weights (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const shares = allocateByWeights(total, weights);
          return (
            shares.length === weights.length &&
            shares.reduce((sum, s) => sum + s, 0) === total &&
            shares.every(Number.isSafeInteger)
          );
        },
      ),
    );
  });
});
