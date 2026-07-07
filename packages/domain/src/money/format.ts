import type { Money } from './money.js';

const digitsCache = new Map<string, number>();

/** Minor-unit digits for a currency (PHP/USD → 2, JPY → 0), via Intl CLDR data. */
export function minorUnitDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  const digits =
    new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  digitsCache.set(currency, digits);
  return digits;
}

/**
 * The one money formatter (design-system.md: numbers always formatted via the
 * domain formatter). Locale comes from store settings; defaults to "en".
 */
export function formatMoney(m: Money, locale = 'en'): string {
  const digits = minorUnitDigits(m.currency);
  const factor = 10 ** digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: m.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(m.amount / factor);
}
