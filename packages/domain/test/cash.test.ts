import { describe, it, expect } from 'vitest';
import { calculateExpectedCash, calculateOverShort } from '../src/index.js';

describe('calculateExpectedCash', () => {
  it('sums float + cash sales − cash refunds + paid in − paid out', () => {
    expect(
      calculateExpectedCash({
        openingFloat: 200000,
        cashSales: 1854000,
        cashRefunds: 16500,
        paidIn: 0,
        paidOut: 50000,
      }),
    ).toBe(1987500); // 2000 + 18540 − 165 − 500 = 19875 (POS-10 mockup figures)
  });

  it('handles an empty drawer beyond float', () => {
    expect(
      calculateExpectedCash({ openingFloat: 500000, cashSales: 0, cashRefunds: 0, paidIn: 0, paidOut: 0 }),
    ).toBe(500000);
  });

  it('counts paid-in back into the drawer', () => {
    expect(
      calculateExpectedCash({ openingFloat: 0, cashSales: 0, cashRefunds: 0, paidIn: 25000, paidOut: 0 }),
    ).toBe(25000);
  });
});

describe('calculateOverShort', () => {
  it('is negative when short', () => {
    expect(calculateOverShort(1975500, 1987500)).toBe(-12000); // −₱120.00
  });

  it('is positive when over', () => {
    expect(calculateOverShort(1990000, 1987500)).toBe(2500);
  });

  it('is zero when exact', () => {
    expect(calculateOverShort(1987500, 1987500)).toBe(0);
  });
});
