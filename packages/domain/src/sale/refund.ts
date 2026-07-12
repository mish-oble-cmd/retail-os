import { assertSafeInteger, divRoundHalfAwayFromZero } from '../money/rounding.js';

/**
 * Refund calculator v1 (FR-1.8, feature-requirements.md). Pure and integer-safe,
 * runs identically on the register (offline) and the server (refund revalidation).
 *
 * A refund selects whole units of existing order lines. The amount refunded for
 * a partial quantity is the stored line total scaled proportionally:
 *
 *   refundAmount = round( lineTotal × refundQty / originalQty )   (half away from 0)
 *
 * and each stored per-line tax component is scaled the same way. This keeps
 * refunds mode-agnostic (the stored total already reflects inclusive/exclusive
 * pricing and every discount) and never invents money: a full-quantity refund
 * of an un-refunded line returns the line total and tax exactly.
 *
 * Restock is per-line and opt-in: a refunded line with `restock` and a variant
 * yields a positive inventory delta (feature-requirements.md §FR-1.8, FR-3.1).
 */

/** An existing order line, as mirrored in the device `order_lines` table. */
export interface RefundableLine {
  readonly id: string;
  readonly variantId?: string | null;
  readonly name?: string;
  /** original quantity sold on this line */
  readonly qty: number;
  /** units already refunded across prior refunds (default 0) */
  readonly refundedQty?: number;
  readonly unitPriceAmount: number;
  /** stored line total (net for inclusive, net+tax for exclusive) */
  readonly totalAmount: number;
  readonly taxLines?: readonly RefundTaxLine[];
}

export interface RefundTaxLine {
  readonly rateId: string;
  readonly amount: number;
}

/** How many units of a given line to refund now, and whether to restock them. */
export interface RefundSelection {
  readonly lineId: string;
  readonly qty: number;
  readonly restock: boolean;
}

export interface RefundInput {
  readonly currency: string;
  readonly lines: readonly RefundableLine[];
  readonly selections: readonly RefundSelection[];
}

export interface RefundLineResult {
  readonly lineId: string;
  readonly variantId: string | null;
  readonly name: string;
  readonly qty: number;
  /** proportional share of the line total — the money refunded for these units */
  readonly amount: number;
  readonly taxLines: readonly RefundTaxLine[];
  readonly taxAmount: number;
  readonly restock: boolean;
}

/** An aggregated positive inventory delta produced by restocked refund units. */
export interface RefundRestock {
  readonly variantId: string;
  readonly qty: number;
}

export interface RefundResult {
  readonly currency: string;
  readonly lines: readonly RefundLineResult[];
  /** Σ per-line tax across the refund */
  readonly taxAmount: number;
  /** Σ per-line amount — the amount owed back to the customer's tender */
  readonly totalAmount: number;
  /** positive inventory deltas, one per restocked variant (merged) */
  readonly restock: readonly RefundRestock[];
}

const scale = (amount: number, refundQty: number, originalQty: number): number =>
  divRoundHalfAwayFromZero(amount * refundQty, originalQty);

export function calculateRefund(input: RefundInput): RefundResult {
  const byId = new Map(input.lines.map((line) => [line.id, line]));
  const lines: RefundLineResult[] = [];
  const restockByVariant = new Map<string, number>();

  for (const selection of input.selections) {
    assertSafeInteger(selection.qty, `refund selection ${selection.lineId} qty`);
    if (selection.qty === 0) continue;
    if (selection.qty < 0) {
      throw new RangeError(`refund qty must be >= 0, got ${selection.qty}`);
    }
    const line = byId.get(selection.lineId);
    if (!line) {
      throw new RangeError(`refund references unknown line ${selection.lineId}`);
    }
    const alreadyRefunded = line.refundedQty ?? 0;
    const remaining = line.qty - alreadyRefunded;
    if (selection.qty > remaining) {
      throw new RangeError(
        `line ${line.id}: cannot refund ${selection.qty} of ${remaining} remaining unit(s)`,
      );
    }

    const amount = scale(line.totalAmount, selection.qty, line.qty);
    const taxLines = (line.taxLines ?? []).map((taxLine) => ({
      rateId: taxLine.rateId,
      amount: scale(taxLine.amount, selection.qty, line.qty),
    }));
    const taxAmount = taxLines.reduce((sum, t) => sum + t.amount, 0);

    lines.push({
      lineId: line.id,
      variantId: line.variantId ?? null,
      name: line.name ?? '',
      qty: selection.qty,
      amount,
      taxLines,
      taxAmount,
      restock: selection.restock,
    });

    if (selection.restock && line.variantId) {
      restockByVariant.set(
        line.variantId,
        (restockByVariant.get(line.variantId) ?? 0) + selection.qty,
      );
    }
  }

  return {
    currency: input.currency,
    lines,
    taxAmount: lines.reduce((sum, l) => sum + l.taxAmount, 0),
    totalAmount: lines.reduce((sum, l) => sum + l.amount, 0),
    restock: [...restockByVariant].map(([variantId, qty]) => ({ variantId, qty })),
  };
}
