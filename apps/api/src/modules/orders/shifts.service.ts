import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { DbService, type TenantTx } from '../../db/db.service';
import { cashMovements, shifts, staff, stores } from '../../db/schema';

/**
 * Read-only shift + Z-report surface for Admin (1D, FR-6.2). Renders exactly the
 * figures the cashier saw at close (the stored z_snapshot); no recomputation.
 */

export interface ShiftSummary {
  id: string;
  currency: string;
  register_id: string;
  location_id: string;
  opened_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  state: 'open' | 'closed';
  opening_float: number;
  over_short: number | null;
  gross_sales: number | null;
}

export interface CashMovementResource {
  id: string;
  kind: 'paid_in' | 'paid_out' | 'no_sale';
  amount: number;
  reason: string;
  staff_id: string | null;
  approved_by_staff_id: string | null;
  client_created_at: string | null;
}

export interface ShiftDetail extends ShiftSummary {
  closed_by: string | null;
  closing_counted: number | null;
  closing_expected: number | null;
  z: unknown;
  movements: CashMovementResource[];
}

type ShiftRow = typeof shifts.$inferSelect;

const grossOf = (z: unknown): number | null => {
  const gross = (z as { grossSales?: number } | null)?.grossSales;
  return typeof gross === 'number' ? gross : null;
};

@Injectable()
export class ShiftsService {
  constructor(private readonly db: DbService) {}

  async list(storeId: string): Promise<ShiftSummary[]> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const currency = await this.storeCurrency(tx, storeId);
      const rows = await tx
        .select({ shift: shifts, openedByName: staff.name })
        .from(shifts)
        .leftJoin(staff, eq(shifts.openedByStaffId, staff.id))
        .orderBy(desc(shifts.openedAt));
      return rows.map((r) => this.toSummary(r.shift, r.openedByName, currency));
    });
  }

  async get(storeId: string, id: string): Promise<ShiftDetail> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const currency = await this.storeCurrency(tx, storeId);
      const [row] = await tx
        .select({ shift: shifts, openedByName: staff.name })
        .from(shifts)
        .leftJoin(staff, eq(shifts.openedByStaffId, staff.id))
        .where(eq(shifts.id, id));
      if (!row) throw new NotFoundException(`Shift ${id} not found`);

      const closedBy = row.shift.closedByStaffId
        ? (await tx.select({ name: staff.name }).from(staff).where(eq(staff.id, row.shift.closedByStaffId)))[0]?.name ?? null
        : null;

      const movements = await tx
        .select()
        .from(cashMovements)
        .where(eq(cashMovements.shiftId, id))
        .orderBy(asc(cashMovements.clientCreatedAt));

      return {
        ...this.toSummary(row.shift, row.openedByName, currency),
        closed_by: closedBy,
        closing_counted: row.shift.closingCounted,
        closing_expected: row.shift.closingExpected,
        z: row.shift.zSnapshot,
        movements: movements.map((m) => ({
          id: m.id,
          kind: m.kind,
          amount: m.amount,
          reason: m.reason,
          staff_id: m.staffId,
          approved_by_staff_id: m.approvedByStaffId,
          client_created_at: m.clientCreatedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  private async storeCurrency(tx: TenantTx, storeId: string): Promise<string> {
    const [row] = await tx.select({ currency: stores.currency }).from(stores).where(eq(stores.id, storeId));
    return row?.currency ?? 'PHP';
  }

  private toSummary(row: ShiftRow, openedByName: string | null, currency: string): ShiftSummary {
    return {
      id: row.id,
      currency,
      register_id: row.registerId,
      location_id: row.locationId,
      opened_by: openedByName,
      opened_at: row.openedAt?.toISOString() ?? null,
      closed_at: row.closedAt?.toISOString() ?? null,
      state: row.state,
      opening_float: row.openingFloat,
      over_short: row.overShort,
      gross_sales: grossOf(row.zSnapshot),
    };
  }
}
