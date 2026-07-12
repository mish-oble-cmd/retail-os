/**
 * @retailos/domain — pure business logic: money, tax, cart. Zero runtime
 * dependencies, zero I/O. Runs identically on POS clients (offline) and the
 * server (sync revalidation) — system-architecture.md AD-2.
 */
export {
  money,
  add,
  subtract,
  multiply,
  negate,
  isZero,
  compare,
  allocate,
  allocateByWeights,
  type Money,
} from './money/money.js';
export { formatMoney, minorUnitDigits } from './money/format.js';
export { divRoundHalfAwayFromZero, applyBasisPoints, assertSafeInteger } from './money/rounding.js';
export { calculateLineTax, sumTax, type TaxRate, type TaxLine, type PriceMode } from './tax/tax.js';
export {
  calculateCart,
  type CartInput,
  type CartLineInput,
  type CartTotals,
  type CartLineTotals,
  type Discount,
} from './cart/cart.js';
export { verifyPin } from './auth/pin.js';
export {
  calculateRefund,
  type RefundInput,
  type RefundableLine,
  type RefundTaxLine,
  type RefundSelection,
  type RefundResult,
  type RefundLineResult,
  type RefundRestock,
} from './sale/refund.js';
export { formatSaleNumber } from './sale/number.js';
