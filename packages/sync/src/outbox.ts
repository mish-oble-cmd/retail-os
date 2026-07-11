import { ulid } from 'ulid';
import type { SqlDriver } from './driver.js';
import type { FactAck, SyncBatchBody, SyncHttp } from './http.js';

/**
 * Outbox + pusher v1 (offline-sync-strategy.md §Client anatomy). The two
 * NON-deferrable guarantees (phase doc §1B):
 *
 * 1. Atomic outbox — fact rows and their outbox entries commit in ONE SQLite
 *    transaction; a crash can never record a sale without queuing it.
 * 2. Idempotent replay — a batch id is assigned when facts are claimed and
 *    persisted on the rows, so a push that dies after the server applied it
 *    retries under the SAME idempotency key and the server dedupes.
 */

export interface LocalDiscount {
  type: 'percent' | 'fixed';
  value: number;
}

export interface LocalTaxLine {
  rateId: string;
  amount: number;
}

export interface LocalSaleLine {
  id: string;
  variantId?: string | null;
  name: string;
  qty: number;
  unitPriceAmount: number;
  discounts: LocalDiscount[];
  taxLines: LocalTaxLine[];
  totalAmount: number;
}

export interface LocalSalePayment {
  id: string;
  tender: 'cash' | 'card_manual';
  amount: number;
  change: number;
  cardRef?: string | null;
  cardLast4?: string | null;
}

export interface LocalStockMovement {
  id: string;
  variantId: string;
  locationId: string;
  qtyDelta: number;
  movementType: 'sale' | 'refund_restock' | 'adjustment';
}

export interface LocalSaleInput {
  id: string;
  number: string;
  staffId: string;
  customerId?: string | null;
  note?: string | null;
  currency: string;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  taxLines: LocalTaxLine[];
  lines: LocalSaleLine[];
  payments: LocalSalePayment[];
  clientCreatedAt: string;
  localSeq: number;
  movements: LocalStockMovement[];
}

const wireTaxLines = (taxLines: LocalTaxLine[]) =>
  taxLines.map((taxLine) => ({ rate_id: taxLine.rateId, amount: taxLine.amount }));

/** The order.completed wire payload (api-design.md representative payload). */
const orderFactPayload = (sale: LocalSaleInput) => ({
  id: sale.id,
  number: sale.number,
  staff_id: sale.staffId,
  customer_id: sale.customerId ?? null,
  note: sale.note ?? null,
  lines: sale.lines.map((line) => ({
    id: line.id,
    variant_id: line.variantId ?? null,
    name: line.name,
    qty: line.qty,
    unit_price: { amount: line.unitPriceAmount, currency: sale.currency },
    discounts: line.discounts,
    tax_lines: wireTaxLines(line.taxLines),
    total_amount: line.totalAmount,
  })),
  totals: sale.totals,
  tax_lines: wireTaxLines(sale.taxLines),
  payments: sale.payments.map((payment) => ({
    id: payment.id,
    tender: payment.tender,
    amount: payment.amount,
    change: payment.change,
    card_ref: payment.cardRef ?? null,
    card_last4: payment.cardLast4 ?? null,
  })),
  client_created_at: sale.clientCreatedAt,
  local_seq: sale.localSeq,
});

const movementFactPayload = (movement: LocalStockMovement, orderId: string) => ({
  id: movement.id,
  variant_id: movement.variantId,
  location_id: movement.locationId,
  qty_delta: movement.qtyDelta,
  movement_type: movement.movementType,
  ref_order_id: orderId,
});

/** Records a completed sale locally: order + lines + payments + movements + outbox, one tx. */
export function recordSale(driver: SqlDriver, sale: LocalSaleInput): void {
  if (!sale.staffId) {
    throw new Error('recordSale: staffId is required — every order is attributed (FR-5.1)');
  }
  driver.tx(() => {
    driver.run(
      `INSERT INTO orders (id, number, staff_id, customer_id, state, currency, subtotal_amount,
         discount_amount, tax_amount, total_amount, tax_lines, note, client_created_at, local_seq)
       VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.id,
        sale.number,
        sale.staffId,
        sale.customerId ?? null,
        sale.currency,
        sale.totals.subtotal,
        sale.totals.discount,
        sale.totals.tax,
        sale.totals.total,
        JSON.stringify(wireTaxLines(sale.taxLines)),
        sale.note ?? null,
        sale.clientCreatedAt,
        sale.localSeq,
      ],
    );
    for (const line of sale.lines) {
      driver.run(
        `INSERT INTO order_lines (id, order_id, variant_id, name, qty, unit_price_amount,
           discounts, tax_lines, total_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          line.id,
          sale.id,
          line.variantId ?? null,
          line.name,
          line.qty,
          line.unitPriceAmount,
          JSON.stringify(line.discounts),
          JSON.stringify(wireTaxLines(line.taxLines)),
          line.totalAmount,
        ],
      );
    }
    for (const payment of sale.payments) {
      driver.run(
        `INSERT INTO payments (id, order_id, tender_type, amount, change_amount, card_ref, card_last4, captured_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.id,
          sale.id,
          payment.tender,
          payment.amount,
          payment.change,
          payment.cardRef ?? null,
          payment.cardLast4 ?? null,
          sale.clientCreatedAt,
        ],
      );
    }
    for (const movement of sale.movements) {
      driver.run(
        `INSERT INTO stock_movements (id, variant_id, location_id, qty_delta, movement_type, ref_order_id, client_created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          movement.id,
          movement.variantId,
          movement.locationId,
          movement.qtyDelta,
          movement.movementType,
          sale.id,
          sale.clientCreatedAt,
        ],
      );
    }
    driver.run(`INSERT INTO outbox (fact_type, entity_id, payload) VALUES (?, ?, ?)`, [
      'order.completed',
      sale.id,
      JSON.stringify(orderFactPayload(sale)),
    ]);
    for (const movement of sale.movements) {
      driver.run(`INSERT INTO outbox (fact_type, entity_id, payload) VALUES (?, ?, ?)`, [
        'stock.movement',
        movement.id,
        JSON.stringify(movementFactPayload(movement, sale.id)),
      ]);
    }
  });
}

export function pendingCount(driver: SqlDriver): number {
  return (
    driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE pushed_at IS NULL`)?.n ?? 0
  );
}

export interface ClaimedBatch {
  batchId: string;
  facts: SyncBatchBody['facts'];
}

interface OutboxRow {
  seq: number;
  fact_type: string;
  entity_id: string;
  payload: string;
  batch_id: string | null;
}

const toFact = (row: OutboxRow): SyncBatchBody['facts'][number] =>
  row.fact_type === 'order.completed'
    ? { type: 'order.completed', order: JSON.parse(row.payload) as Record<string, unknown> }
    : { type: 'stock.movement', movement: JSON.parse(row.payload) as Record<string, unknown> };

/**
 * Claims the next batch of pending facts. If a previous claim was never
 * acked (crash/network loss mid-push), the SAME batch id and rows come back.
 */
export function claimBatch(driver: SqlDriver, max = 500): ClaimedBatch | null {
  return driver.tx(() => {
    const head = driver.get<OutboxRow>(
      `SELECT seq, fact_type, entity_id, payload, batch_id FROM outbox
       WHERE pushed_at IS NULL ORDER BY seq LIMIT 1`,
    );
    if (!head) return null;
    if (head.batch_id) {
      const rows = driver.all<OutboxRow>(
        `SELECT seq, fact_type, entity_id, payload, batch_id FROM outbox
         WHERE batch_id = ? AND pushed_at IS NULL ORDER BY seq`,
        [head.batch_id],
      );
      return { batchId: head.batch_id, facts: rows.map(toFact) };
    }
    const batchId = ulid();
    const rows = driver.all<OutboxRow>(
      `SELECT seq, fact_type, entity_id, payload, batch_id FROM outbox
       WHERE pushed_at IS NULL AND batch_id IS NULL ORDER BY seq LIMIT ?`,
      [max],
    );
    for (const row of rows) {
      driver.run(`UPDATE outbox SET batch_id = ? WHERE seq = ?`, [batchId, row.seq]);
    }
    return { batchId, facts: rows.map(toFact) };
  });
}

export function markPushed(driver: SqlDriver, batchId: string, _acks: FactAck[]): void {
  driver.run(`UPDATE outbox SET pushed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE batch_id = ?`, [
    batchId,
  ]);
}

/** Pushes one claimed batch; null when the outbox is drained. */
export async function pushOnce(
  driver: SqlDriver,
  http: SyncHttp,
  registerId: string,
): Promise<{ pushed: number } | null> {
  const claimed = claimBatch(driver);
  if (!claimed) return null;
  const { acks } = await http.postBatch({
    batch_id: claimed.batchId,
    client: { register_id: registerId },
    facts: claimed.facts,
  });
  markPushed(driver, claimed.batchId, acks);
  return { pushed: claimed.facts.length };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drains the whole outbox, retrying transient failures with exponential
 * backoff + jitter (capped at 30 s). Throws once retries are exhausted —
 * nothing is lost, the claimed batch survives for the next run.
 */
export async function pushWithRetry(
  driver: SqlDriver,
  http: SyncHttp,
  registerId: string,
  opts?: { retries?: number; baseDelayMs?: number; jitter?: () => number },
): Promise<{ pushed: number }> {
  const retries = opts?.retries ?? 8;
  const baseDelayMs = opts?.baseDelayMs ?? 500;
  const jitter = opts?.jitter ?? Math.random;
  let pushed = 0;
  let attempt = 0;
  for (;;) {
    try {
      const result = await pushOnce(driver, http, registerId);
      if (!result) return { pushed };
      pushed += result.pushed;
      attempt = 0; // a successful batch resets the budget
    } catch (error) {
      attempt += 1;
      if (attempt > retries) throw error;
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) * (0.5 + jitter()), 30_000);
      await sleep(delay);
    }
  }
}
