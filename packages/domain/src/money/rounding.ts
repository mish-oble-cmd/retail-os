/**
 * Integer-only rounding helpers. All money math in RetailOS is integer minor
 * units; rates are integer basis points. "Half-up" per data-model.md §Tax
 * means half away from zero, so refund math mirrors sale math exactly.
 */

export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer, got ${value}`);
  }
}

/**
 * (numerator / denominator) rounded half away from zero, without ever
 * leaving integer arithmetic. Denominator must be a positive integer.
 */
export function divRoundHalfAwayFromZero(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');
  if (denominator <= 0) {
    throw new RangeError(`denominator must be positive, got ${denominator}`);
  }
  const negative = numerator < 0;
  const n = negative ? -numerator : numerator;
  const quotient = Math.trunc(n / denominator);
  const remainder = n - quotient * denominator;
  const rounded = 2 * remainder >= denominator ? quotient + 1 : quotient;
  return negative ? -rounded : rounded;
}

/** round(amount × rateBp / 10000) — the basic basis-point application. */
export function applyBasisPoints(amount: number, basisPoints: number): number {
  assertSafeInteger(amount, 'amount');
  assertSafeInteger(basisPoints, 'basisPoints');
  return divRoundHalfAwayFromZero(amount * basisPoints, 10_000);
}
