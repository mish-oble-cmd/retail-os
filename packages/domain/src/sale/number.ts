import { assertSafeInteger } from '../money/rounding.js';

/**
 * Human-facing sale number. The register mints a monotonic per-device sequence
 * (`local_seq` in the device DB); this formats it for receipts and the orders
 * list. Pure and deterministic — the same seq always renders the same number.
 *
 * Example: formatSaleNumber(42, { prefix: 'R2' }) === 'R2-0042'
 */
export function formatSaleNumber(
  seq: number,
  opts: { prefix?: string; padTo?: number } = {},
): string {
  assertSafeInteger(seq, 'sale number seq');
  if (seq < 0) {
    throw new RangeError(`sale number seq must be >= 0, got ${seq}`);
  }
  const padTo = opts.padTo ?? 4;
  const body = String(seq).padStart(padTo, '0');
  return opts.prefix ? `${opts.prefix}-${body}` : body;
}
