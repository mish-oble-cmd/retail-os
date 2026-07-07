import { assertSafeInteger } from './rounding.js';

/**
 * Money is an integer amount of minor units (centavos, cents) plus an ISO
 * 4217 currency code. Never a float — CLAUDE.md ground rule 5.
 */
export interface Money {
  readonly amount: number;
  readonly currency: string;
}

export function money(amount: number, currency: string): Money {
  assertSafeInteger(amount, 'amount');
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RangeError(`currency must be a 3-letter ISO 4217 code, got "${currency}"`);
  }
  return { amount, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new RangeError(`currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function multiply(m: Money, factor: number): Money {
  assertSafeInteger(factor, 'factor');
  return money(m.amount * factor, m.currency);
}

export function negate(m: Money): Money {
  return money(-m.amount, m.currency);
}

export function isZero(m: Money): boolean {
  return m.amount === 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

/**
 * Split an amount across integer weights with no cent lost or invented
 * (largest-remainder method). Ties go to the earlier index, so allocation is
 * deterministic — the same split computes identically on POS and server.
 */
export function allocateByWeights(total: number, weights: readonly number[]): number[] {
  assertSafeInteger(total, 'total');
  if (weights.length === 0) {
    throw new RangeError('allocateByWeights requires at least one weight');
  }
  let weightSum = 0;
  for (const w of weights) {
    assertSafeInteger(w, 'weight');
    if (w < 0) throw new RangeError(`weights must be >= 0, got ${w}`);
    weightSum += w;
  }
  if (weightSum === 0) {
    // Nothing to apportion against; everything lands on the first slot.
    const shares = new Array<number>(weights.length).fill(0);
    shares[0] = total;
    return shares;
  }

  const negative = total < 0;
  const t = negative ? -total : total;
  // BigInt intermediates: total × weight can exceed 2^53 on large carts even
  // though every input and output fits comfortably in safe-integer range.
  const bigT = BigInt(t);
  const bigWeightSum = BigInt(weightSum);
  const shares: number[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0;
  for (let i = 0; i < weights.length; i++) {
    const raw = bigT * BigInt(weights[i] ?? 0);
    const share = Number(raw / bigWeightSum);
    shares.push(share);
    allocated += share;
    remainders.push({ index: i, remainder: raw % bigWeightSum });
  }
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : b.remainder > a.remainder ? 1 : -1,
  );
  for (let leftover = t - allocated, j = 0; leftover > 0; leftover--, j++) {
    const target = remainders[j % remainders.length];
    if (target) shares[target.index] = (shares[target.index] ?? 0) + 1;
  }
  return negative ? shares.map((s) => -s) : shares;
}

export function allocate(m: Money, weights: readonly number[]): Money[] {
  return allocateByWeights(m.amount, weights).map((amount) => money(amount, m.currency));
}
