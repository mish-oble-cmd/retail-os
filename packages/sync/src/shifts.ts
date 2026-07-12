/**
 * Device-local shift lifecycle (1D, FR-6.1/6.2). Open a shift with a counted
 * float, record paid in/out and no-sale movements, close with a blind count
 * and a Z-report snapshot. Each mutation writes its row and an outbox fact in
 * the same transaction — the same atomic pattern as recordSale/recordRefund.
 */
import type { SqlDriver } from './driver.js';
import type { ZReportMovement, ZReportOrder, ZReportRefund, ZSnapshot } from '@retailos/domain';

export interface OpenShiftInput {
  id: string;
  registerId: string;
  locationId: string;
  openedByStaffId: string;
  openingFloat: number;
  clientCreatedAt: string;
  localSeq: number;
}

export type CashMovementKind = 'paid_in' | 'paid_out' | 'no_sale';

export interface CashMovementInput {
  id: string;
  shiftId: string;
  kind: CashMovementKind;
  amount: number;
  reason: string;
  staffId: string;
  approvedByStaffId?: string | null;
  clientCreatedAt: string;
}

export interface CloseShiftInput {
  id: string;
  closedByStaffId: string;
  closedAt: string;
  closingCounted: number;
  closingExpected: number;
  overShort: number;
  z: ZSnapshot;
}

export interface ActiveShift {
  id: string;
  registerId: string;
  locationId: string;
  openedByStaffId: string;
  openedAt: string;
  openingFloat: number;
}

export interface ShiftZSource {
  orders: ZReportOrder[];
  refunds: ZReportRefund[];
  movements: ZReportMovement[];
  openingFloat: number;
}

const tender = (t: string): 'cash' | 'card_manual' => (t === 'cash' ? 'cash' : 'card_manual');

/**
 * Opens a shift. The partial-unique index shifts_one_open_per_register makes a
 * second open on the same register throw — the caller routes an existing open
 * shift straight to Sell instead.
 */
export function openShift(driver: SqlDriver, input: OpenShiftInput): void {
  driver.tx(() => {
    driver.run(
      `INSERT INTO shifts (id, register_id, location_id, opened_by_staff_id, opened_at,
         opening_float, state, local_seq)
       VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      [
        input.id,
        input.registerId,
        input.locationId,
        input.openedByStaffId,
        input.clientCreatedAt,
        input.openingFloat,
        input.localSeq,
      ],
    );
    driver.run(`INSERT INTO outbox (fact_type, entity_id, payload) VALUES (?, ?, ?)`, [
      'shift.opened',
      input.id,
      JSON.stringify({
        id: input.id,
        register_id: input.registerId,
        location_id: input.locationId,
        opened_by_staff_id: input.openedByStaffId,
        opened_at: input.clientCreatedAt,
        opening_float: input.openingFloat,
      }),
    ]);
  });
}

/** Records a paid-in / paid-out / no-sale movement + its outbox fact. */
export function recordCashMovement(driver: SqlDriver, input: CashMovementInput): void {
  driver.tx(() => {
    driver.run(
      `INSERT INTO cash_movements (id, shift_id, kind, amount, reason, staff_id,
         approved_by_staff_id, client_created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.shiftId,
        input.kind,
        input.amount,
        input.reason,
        input.staffId,
        input.approvedByStaffId ?? null,
        input.clientCreatedAt,
      ],
    );
    driver.run(`INSERT INTO outbox (fact_type, entity_id, payload) VALUES (?, ?, ?)`, [
      'cash.movement',
      input.id,
      JSON.stringify({
        id: input.id,
        shift_id: input.shiftId,
        kind: input.kind,
        amount: input.amount,
        reason: input.reason,
        staff_id: input.staffId,
        approved_by_staff_id: input.approvedByStaffId ?? null,
        client_created_at: input.clientCreatedAt,
      }),
    ]);
  });
}

/**
 * Closes the shift: updates the row to 'closed' with the blind count, expected,
 * over/short, and the Z snapshot, then emits the shift.closed fact carrying the
 * snapshot so the server stores exactly what the cashier saw.
 */
export function closeShift(driver: SqlDriver, input: CloseShiftInput): void {
  driver.tx(() => {
    driver.run(
      `UPDATE shifts SET state = 'closed', closed_by_staff_id = ?, closed_at = ?,
         closing_counted = ?, closing_expected = ?, over_short = ?, z_snapshot = ?
       WHERE id = ?`,
      [
        input.closedByStaffId,
        input.closedAt,
        input.closingCounted,
        input.closingExpected,
        input.overShort,
        JSON.stringify(input.z),
        input.id,
      ],
    );
    driver.run(`INSERT INTO outbox (fact_type, entity_id, payload) VALUES (?, ?, ?)`, [
      'shift.closed',
      input.id,
      JSON.stringify({
        id: input.id,
        closed_by_staff_id: input.closedByStaffId,
        closed_at: input.closedAt,
        closing_counted: input.closingCounted,
        closing_expected: input.closingExpected,
        over_short: input.overShort,
        z: input.z,
      }),
    ]);
  });
}

/** The single open shift for a register, or null. */
export function getActiveShift(driver: SqlDriver, registerId: string): ActiveShift | null {
  const row = driver.get<{
    id: string;
    register_id: string;
    location_id: string;
    opened_by_staff_id: string;
    opened_at: string;
    opening_float: number;
  }>(
    `SELECT id, register_id, location_id, opened_by_staff_id, opened_at, opening_float
     FROM shifts WHERE register_id = ? AND state = 'open'`,
    [registerId],
  );
  if (!row) return null;
  return {
    id: row.id,
    registerId: row.register_id,
    locationId: row.location_id,
    openedByStaffId: row.opened_by_staff_id,
    openedAt: row.opened_at,
    openingFloat: row.opening_float,
  };
}

/**
 * Gathers everything buildZReport needs for a shift: its orders (with payment
 * tender breakdown), refunds (as cash/card amounts), cash movements, and the
 * opening float. The caller supplies the blind counted cash.
 */
export function getShiftZSource(driver: SqlDriver, shiftId: string): ShiftZSource {
  const shift = driver.get<{ opening_float: number }>(
    `SELECT opening_float FROM shifts WHERE id = ?`,
    [shiftId],
  );

  const orderRows = driver.all<{
    id: string;
    staff_id: string | null;
    subtotal_amount: number;
    discount_amount: number;
    tax_amount: number;
    total_amount: number;
  }>(
    `SELECT id, staff_id, subtotal_amount, discount_amount, tax_amount, total_amount
     FROM orders WHERE shift_id = ?`,
    [shiftId],
  );

  const orders: ZReportOrder[] = orderRows.map((o) => {
    const payments = driver
      .all<{ tender_type: string; amount: number }>(
        `SELECT tender_type, amount FROM payments WHERE order_id = ?`,
        [o.id],
      )
      .map((p) => ({ tender: tender(p.tender_type), amount: p.amount }));
    return {
      staffId: o.staff_id,
      subtotal: o.subtotal_amount,
      discount: o.discount_amount,
      tax: o.tax_amount,
      total: o.total_amount,
      payments,
    };
  });

  const refunds: ZReportRefund[] = driver
    .all<{ tender_type: string; total_amount: number }>(
      `SELECT r.tender_type, r.total_amount FROM refunds r
       JOIN orders o ON o.id = r.order_id WHERE o.shift_id = ?`,
      [shiftId],
    )
    .map((r) => ({ tender: tender(r.tender_type), amount: r.total_amount }));

  const movements: ZReportMovement[] = driver
    .all<{ kind: CashMovementKind; amount: number }>(
      `SELECT kind, amount FROM cash_movements WHERE shift_id = ?`,
      [shiftId],
    )
    .map((m) => ({ kind: m.kind, amount: m.amount }));

  return { orders, refunds, movements, openingFloat: shift?.opening_float ?? 0 };
}
