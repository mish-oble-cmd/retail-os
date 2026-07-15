import { z } from 'zod';

/** Request schemas for the sync surface (api-design.md §/sync). */

export const activateDeviceSchema = z.object({
  /** 8-char Crockford base32; tolerate a display hyphen (ABCD-EFGH). */
  code: z
    .string()
    .transform((value) => value.replace(/-/g, '').trim().toUpperCase())
    .pipe(z.string().length(8)),
  app_version: z.string().max(50).optional(),
});
export type ActivateDeviceInput = z.infer<typeof activateDeviceSchema>;

export const changesQuerySchema = z.object({
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(500),
});

// ---- POST /sync/batches (api-design.md §Representative payloads) ------------

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');

/** Mirrors @retailos/domain Discount: percent = basis points, fixed = minor units. */
const discountSchema = z.object({
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(0),
});

const taxLineSchema = z.object({
  rate_id: z.string().min(1),
  amount: z.number().int(),
});

const orderFactSchema = z.object({
  type: z.literal('order.completed'),
  order: z.object({
    id: ulidSchema,
    number: z.string().min(1).max(30),
    staff_id: ulidSchema.nullish(),
    shift_id: ulidSchema.nullish(),
    customer_id: ulidSchema.nullish(),
    note: z.string().max(2000).nullish(),
    lines: z
      .array(
        z.object({
          id: ulidSchema,
          variant_id: ulidSchema.nullish(),
          name: z.string().min(1),
          qty: z.number().int().positive(),
          unit_price: z.object({ amount: z.number().int().min(0), currency: z.string().length(3) }),
          discounts: z.array(discountSchema).default([]),
          tax_lines: z.array(taxLineSchema).default([]),
          total_amount: z.number().int(),
        }),
      )
      .min(1),
    totals: z.object({
      subtotal: z.number().int(),
      discount: z.number().int(),
      tax: z.number().int(),
      total: z.number().int(),
    }),
    tax_lines: z.array(taxLineSchema).default([]),
    payments: z
      .array(
        z.object({
          id: ulidSchema,
          tender: z.enum(['cash', 'card_manual']),
          amount: z.number().int(),
          change: z.number().int().min(0).default(0),
          card_ref: z.string().max(100).nullish(),
          card_last4: z.string().max(4).nullish(),
        }),
      )
      .min(1),
    client_created_at: z.string().datetime(),
    local_seq: z.number().int().positive(),
  }),
});

const refundFactSchema = z.object({
  type: z.literal('refund.completed'),
  refund: z.object({
    id: ulidSchema,
    order_id: ulidSchema,
    staff_id: ulidSchema,
    approved_by: ulidSchema.nullish(),
    currency: z.string().length(3),
    total_amount: z.number().int(),
    tax_amount: z.number().int().default(0),
    tax_lines: z.array(taxLineSchema).default([]),
    tender: z.enum(['cash', 'card_manual']),
    card_ref: z.string().max(100).nullish(),
    card_last4: z.string().max(4).nullish(),
    lines: z
      .array(
        z.object({
          id: ulidSchema,
          order_line_id: ulidSchema,
          variant_id: ulidSchema.nullish(),
          qty: z.number().int().positive(),
          amount: z.number().int(),
          restock: z.boolean().default(false),
        }),
      )
      .min(1),
    client_created_at: z.string().datetime(),
    local_seq: z.number().int().positive(),
  }),
});

const movementFactSchema = z.object({
  type: z.literal('stock.movement'),
  movement: z.object({
    id: ulidSchema,
    variant_id: ulidSchema,
    location_id: ulidSchema,
    qty_delta: z.number().int(),
    movement_type: z.enum(['sale', 'refund_restock', 'adjustment']),
    ref_order_id: ulidSchema.nullish(),
    client_created_at: z.string().datetime().optional(),
  }),
});

const shiftOpenedFactSchema = z.object({
  type: z.literal('shift.opened'),
  shift: z.object({
    id: ulidSchema,
    register_id: ulidSchema,
    location_id: ulidSchema,
    opened_by_staff_id: ulidSchema,
    opened_at: z.string().datetime(),
    opening_float: z.number().int().min(0),
  }),
});

const cashMovementFactSchema = z.object({
  type: z.literal('cash.movement'),
  movement: z.object({
    id: ulidSchema,
    shift_id: ulidSchema,
    kind: z.enum(['paid_in', 'paid_out', 'no_sale']),
    amount: z.number().int().min(0).default(0),
    reason: z.string().max(500).default(''),
    staff_id: ulidSchema,
    approved_by_staff_id: ulidSchema.nullish(),
    client_created_at: z.string().datetime(),
  }),
});

// Z-report snapshot computed on-device at close, stored verbatim.
const zSnapshotSchema = z.object({
  grossSales: z.number().int(),
  netSales: z.number().int(),
  taxCollected: z.number().int(),
  discounts: z.number().int(),
  refunds: z.number().int(),
  txnCount: z.number().int(),
  tenders: z.object({ cash: z.number().int(), card_manual: z.number().int() }),
  cashRefunds: z.number().int(),
  byStaff: z.array(
    z.object({ staffId: z.string(), netSales: z.number().int(), txnCount: z.number().int() }),
  ),
  openingFloat: z.number().int(),
  paidIn: z.number().int(),
  paidOut: z.number().int(),
  expectedCash: z.number().int(),
  countedCash: z.number().int(),
  overShort: z.number().int(),
});

const shiftClosedFactSchema = z.object({
  type: z.literal('shift.closed'),
  shift: z.object({
    id: ulidSchema,
    closed_by_staff_id: ulidSchema,
    closed_at: z.string().datetime(),
    closing_counted: z.number().int(),
    closing_expected: z.number().int(),
    over_short: z.number().int(),
    z: zSnapshotSchema,
  }),
});

export const syncBatchSchema = z.object({
  batch_id: ulidSchema,
  client: z.object({
    register_id: ulidSchema,
    app_version: z.string().max(50).optional(),
    schema_rev: z.number().int().optional(),
  }),
  facts: z
    .array(
      z.discriminatedUnion('type', [
        orderFactSchema,
        refundFactSchema,
        movementFactSchema,
        shiftOpenedFactSchema,
        cashMovementFactSchema,
        shiftClosedFactSchema,
      ]),
    )
    .min(1)
    .max(500),
});

export type SyncBatchInput = z.infer<typeof syncBatchSchema>;
export type OrderFact = z.infer<typeof orderFactSchema>;
export type RefundFact = z.infer<typeof refundFactSchema>;
export type MovementFact = z.infer<typeof movementFactSchema>;
export type ShiftOpenedFact = z.infer<typeof shiftOpenedFactSchema>;
export type CashMovementFact = z.infer<typeof cashMovementFactSchema>;
export type ShiftClosedFact = z.infer<typeof shiftClosedFactSchema>;
