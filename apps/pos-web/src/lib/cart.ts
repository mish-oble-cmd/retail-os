import { calculateCart, type CartTotals, type Discount, type PriceMode } from '@retailos/domain';
import { useMemo, useState } from 'react';
import type { SellableVariant, TaxRateRow } from '@retailos/sync';

/**
 * In-progress cart state for the Sell screen (POS-03). Line math is delegated
 * wholesale to `@retailos/domain` `calculateCart` — the register never computes
 * money itself, so totals are identical to the server's revalidation (AD-2).
 */

export interface DiscountMeta {
  /** required reason, printed itemized on the receipt (FR-1.2) */
  reason: string;
  /** Owner staff id when the discount needed escalation (FR-5.2), else null */
  approvedBy: string | null;
}

export interface CartLine {
  /** stable row key (a line, not a variant — custom sales have no variant) */
  key: string;
  variantId: string | null;
  name: string;
  unitPriceAmount: number;
  qty: number;
  taxRates: { id: string; rateBp: number }[];
  discounts: Discount[];
  discountMeta?: DiscountMeta;
  isCustom?: boolean;
}

export interface Cart {
  lines: CartLine[];
  cartDiscount: Discount | null;
  cartDiscountMeta?: DiscountMeta;
}

const emptyCart: Cart = { lines: [], cartDiscount: null };

let keySeq = 0;
const nextKey = () => `line-${++keySeq}`;

export interface UseCart {
  cart: Cart;
  lines: CartLine[];
  itemCount: number;
  totals: CartTotals;
  addVariant(variant: SellableVariant, taxRates: TaxRateRow[]): void;
  addCustom(input: { name: string; unitPriceAmount: number; taxRates: TaxRateRow[] }): void;
  setQty(key: string, qty: number): void;
  removeLine(key: string): void;
  setLineDiscount(key: string, discount: Discount | null, meta?: DiscountMeta): void;
  setCartDiscount(discount: Discount | null, meta?: DiscountMeta): void;
  replace(cart: Cart): void;
  clear(): void;
}

const toDomainRates = (rates: TaxRateRow[]) => rates.map((r) => ({ id: r.id, rateBp: r.rateBp }));

export function useCart(currency: string, priceMode: PriceMode): UseCart {
  const [cart, setCart] = useState<Cart>(emptyCart);

  const totals = useMemo(
    () =>
      calculateCart({
        currency,
        priceMode,
        lines: cart.lines.map((line) => ({
          id: line.key,
          unitPriceAmount: line.unitPriceAmount,
          qty: line.qty,
          discounts: line.discounts,
          taxRates: line.taxRates,
        })),
        discounts: cart.cartDiscount ? [cart.cartDiscount] : [],
      }),
    [cart, currency, priceMode],
  );

  const itemCount = cart.lines.reduce((sum, line) => sum + line.qty, 0);

  return {
    cart,
    lines: cart.lines,
    itemCount,
    totals,
    addVariant(variant, taxRates) {
      setCart((current) => {
        // Merge into an existing non-custom line for the same variant.
        const existing = current.lines.find(
          (line) => !line.isCustom && line.variantId === variant.variantId,
        );
        if (existing) {
          return {
            ...current,
            lines: current.lines.map((line) =>
              line.key === existing.key ? { ...line, qty: line.qty + 1 } : line,
            ),
          };
        }
        return {
          ...current,
          lines: [
            ...current.lines,
            {
              key: nextKey(),
              variantId: variant.variantId,
              name: variant.productName,
              unitPriceAmount: variant.priceAmount,
              qty: 1,
              taxRates: toDomainRates(taxRates),
              discounts: [],
            },
          ],
        };
      });
    },
    addCustom({ name, unitPriceAmount, taxRates }) {
      setCart((current) => ({
        ...current,
        lines: [
          ...current.lines,
          {
            key: nextKey(),
            variantId: null,
            name,
            unitPriceAmount,
            qty: 1,
            taxRates: toDomainRates(taxRates),
            discounts: [],
            isCustom: true,
          },
        ],
      }));
    },
    setQty(key, qty) {
      setCart((current) => ({
        ...current,
        lines:
          qty <= 0
            ? current.lines.filter((line) => line.key !== key)
            : current.lines.map((line) => (line.key === key ? { ...line, qty } : line)),
      }));
    },
    removeLine(key) {
      setCart((current) => ({ ...current, lines: current.lines.filter((line) => line.key !== key) }));
    },
    setLineDiscount(key, discount, meta) {
      setCart((current) => ({
        ...current,
        lines: current.lines.map((line) =>
          line.key === key
            ? { ...line, discounts: discount ? [discount] : [], discountMeta: discount ? meta : undefined }
            : line,
        ),
      }));
    },
    setCartDiscount(discount, meta) {
      setCart((current) => ({
        ...current,
        cartDiscount: discount,
        cartDiscountMeta: discount ? meta : undefined,
      }));
    },
    replace(next) {
      setCart(next);
    },
    clear() {
      setCart(emptyCart);
    },
  };
}
