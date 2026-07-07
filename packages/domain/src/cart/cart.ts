import { allocateByWeights } from '../money/money.js';
import { applyBasisPoints, assertSafeInteger } from '../money/rounding.js';
import {
  calculateLineTax,
  sumTax,
  type PriceMode,
  type TaxLine,
  type TaxRate,
} from '../tax/tax.js';

/**
 * Cart calculator v1 (phase-0-foundations.md §0.2): lines, quantities,
 * line-level and cart-level discounts (% or fixed), totals. Runs identically
 * on POS (offline) and server (sync revalidation) — AD-2.
 *
 * Discount semantics (data-model.md §Tax, Phase 0 clarifications):
 * - discounts on a line apply sequentially to its running amount
 * - cart-level discounts apply in order to the cart's running total and are
 *   allocated across lines proportionally (largest remainder, no lost cents)
 *   BEFORE tax computes — tax always sees discounted line amounts
 * - a fixed discount larger than what remains clamps; amounts never go negative
 */

export interface Discount {
  readonly type: 'percent' | 'fixed';
  /** percent: basis points (1000 = 10%); fixed: minor units */
  readonly value: number;
}

export interface CartLineInput {
  readonly id: string;
  readonly unitPriceAmount: number;
  readonly qty: number;
  readonly discounts?: readonly Discount[];
  readonly taxRates?: readonly TaxRate[];
}

export interface CartInput {
  readonly currency: string;
  readonly priceMode: PriceMode;
  readonly lines: readonly CartLineInput[];
  /** cart-level discounts, applied in array order */
  readonly discounts?: readonly Discount[];
}

export interface CartLineTotals {
  readonly id: string;
  /** unitPrice × qty, before any discount */
  readonly grossAmount: number;
  readonly lineDiscountAmount: number;
  /** this line's allocated share of cart-level discounts */
  readonly cartDiscountAmount: number;
  /** discounted amount — the tax basis */
  readonly netAmount: number;
  readonly taxLines: readonly TaxLine[];
  readonly taxAmount: number;
  /** exclusive: net + tax; inclusive: net (tax already inside) */
  readonly totalAmount: number;
}

export interface CartTotals {
  readonly currency: string;
  readonly priceMode: PriceMode;
  readonly lines: readonly CartLineTotals[];
  /** Σ gross */
  readonly subtotalAmount: number;
  /** Σ line + cart discounts */
  readonly discountAmount: number;
  /** Σ line taxes (informational component in inclusive mode) */
  readonly taxAmount: number;
  readonly totalAmount: number;
}

function applyDiscountsSequentially(startAmount: number, discounts: readonly Discount[]): number {
  let current = startAmount;
  for (const discount of discounts) {
    assertSafeInteger(discount.value, 'discount value');
    if (discount.value < 0) {
      throw new RangeError(`discount value must be >= 0, got ${discount.value}`);
    }
    const off =
      discount.type === 'percent'
        ? applyBasisPoints(current, discount.value)
        : Math.min(discount.value, current);
    current = Math.max(0, current - off);
  }
  return current;
}

export function calculateCart(input: CartInput): CartTotals {
  // 1) gross + line-level discounts
  const grosses: number[] = [];
  const afterLineDiscounts: number[] = [];
  for (const line of input.lines) {
    assertSafeInteger(line.unitPriceAmount, `line ${line.id} unitPriceAmount`);
    assertSafeInteger(line.qty, `line ${line.id} qty`);
    if (line.unitPriceAmount < 0 || line.qty < 0) {
      throw new RangeError(`line ${line.id}: unit price and qty must be >= 0`);
    }
    const gross = line.unitPriceAmount * line.qty;
    assertSafeInteger(gross, `line ${line.id} gross`);
    grosses.push(gross);
    afterLineDiscounts.push(applyDiscountsSequentially(gross, line.discounts ?? []));
  }

  // 2) cart-level discounts, allocated proportionally to current line amounts
  const cartDiscountPerLine = new Array<number>(input.lines.length).fill(0);
  const current = [...afterLineDiscounts];
  for (const discount of input.discounts ?? []) {
    assertSafeInteger(discount.value, 'cart discount value');
    if (discount.value < 0) {
      throw new RangeError(`discount value must be >= 0, got ${discount.value}`);
    }
    const base = current.reduce((sum, amount) => sum + amount, 0);
    if (base === 0 || input.lines.length === 0) continue;
    const off =
      discount.type === 'percent'
        ? applyBasisPoints(base, discount.value)
        : Math.min(discount.value, base);
    const shares = allocateByWeights(off, current);
    for (let i = 0; i < shares.length; i++) {
      const share = Math.min(shares[i] ?? 0, current[i] ?? 0);
      current[i] = (current[i] ?? 0) - share;
      cartDiscountPerLine[i] = (cartDiscountPerLine[i] ?? 0) + share;
    }
  }

  // 3) taxes on discounted amounts, then totals
  const lines: CartLineTotals[] = input.lines.map((line, i) => {
    const gross = grosses[i] ?? 0;
    const net = current[i] ?? 0;
    const lineDiscount = gross - (afterLineDiscounts[i] ?? 0);
    const cartDiscount = cartDiscountPerLine[i] ?? 0;
    const taxLines = calculateLineTax(net, line.taxRates ?? [], input.priceMode);
    const taxAmount = sumTax(taxLines);
    return {
      id: line.id,
      grossAmount: gross,
      lineDiscountAmount: lineDiscount,
      cartDiscountAmount: cartDiscount,
      netAmount: net,
      taxLines,
      taxAmount,
      totalAmount: input.priceMode === 'tax_exclusive' ? net + taxAmount : net,
    };
  });

  return {
    currency: input.currency,
    priceMode: input.priceMode,
    lines,
    subtotalAmount: lines.reduce((sum, l) => sum + l.grossAmount, 0),
    discountAmount: lines.reduce((sum, l) => sum + l.lineDiscountAmount + l.cartDiscountAmount, 0),
    taxAmount: lines.reduce((sum, l) => sum + l.taxAmount, 0),
    totalAmount: lines.reduce((sum, l) => sum + l.totalAmount, 0),
  };
}
