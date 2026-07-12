/**
 * Cash-drawer reconciliation math for shifts (FR-6.1). Pure integer minor
 * units — runs identically on the POS client (offline close) and the server.
 */

export interface ExpectedCashInput {
  /** Counted float the drawer opened with. */
  openingFloat: number;
  /** Sum of cash-tender payments taken during the shift. */
  cashSales: number;
  /** Sum of cash refunds paid out from the drawer during the shift. */
  cashRefunds: number;
  /** Sum of paid-in cash movements. */
  paidIn: number;
  /** Sum of paid-out cash movements. */
  paidOut: number;
}

/** Expected cash in the drawer at close (minor units). */
export function calculateExpectedCash(i: ExpectedCashInput): number {
  return i.openingFloat + i.cashSales - i.cashRefunds + i.paidIn - i.paidOut;
}

/** Signed over/short: positive = over, negative = short (minor units). */
export function calculateOverShort(counted: number, expected: number): number {
  return counted - expected;
}
