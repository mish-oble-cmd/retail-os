import { assertSafeInteger, divRoundHalfAwayFromZero } from '../money/rounding.js';

/**
 * Tax engine per data-model.md §Tax computation (locked decision):
 * - rates are integer basis points (12% VAT = 1200 bp)
 * - exclusive: each rate applies to the discounted line amount, rounded
 *   half away from zero
 * - inclusive: tax is extracted from gross; with multiple rates,
 *   tax_i = round(gross × rate_i / (10000 + Σrates)) so the implied net base
 *   is shared and any residual cent stays in net (never invented tax)
 */

export interface TaxRate {
  readonly id: string;
  readonly rateBp: number;
}

export type PriceMode = 'tax_inclusive' | 'tax_exclusive';

export interface TaxLine {
  readonly rateId: string;
  readonly rateBp: number;
  readonly amount: number;
}

export function calculateLineTax(
  taxableAmount: number,
  rates: readonly TaxRate[],
  mode: PriceMode,
): TaxLine[] {
  assertSafeInteger(taxableAmount, 'taxableAmount');
  let totalBp = 0;
  for (const rate of rates) {
    assertSafeInteger(rate.rateBp, `rate ${rate.id} rateBp`);
    if (rate.rateBp < 0) {
      throw new RangeError(`rate ${rate.id} must be >= 0 bp, got ${rate.rateBp}`);
    }
    totalBp += rate.rateBp;
  }
  const denominator = mode === 'tax_inclusive' ? 10_000 + totalBp : 10_000;
  return rates.map((rate) => ({
    rateId: rate.id,
    rateBp: rate.rateBp,
    amount: divRoundHalfAwayFromZero(taxableAmount * rate.rateBp, denominator),
  }));
}

export function sumTax(taxLines: readonly TaxLine[]): number {
  return taxLines.reduce((sum, line) => sum + line.amount, 0);
}
