import type { SqlDriver } from './driver.js';

/**
 * Device read helpers (1C): the Sell screen, orders list and refund flow read
 * exclusively from the local mirror — the UI never awaits the network
 * (system-architecture.md). Money stays integer minor units; JSON columns are
 * parsed here so screens receive typed rows.
 */

export interface StoreMeta {
  id: string;
  name: string;
  currency: string;
  priceMode: 'tax_inclusive' | 'tax_exclusive';
}

export function getStoreMeta(driver: SqlDriver): StoreMeta | undefined {
  const row = driver.get<{
    id: string;
    name: string;
    currency: string;
    price_mode: string;
  }>(`SELECT id, name, currency, price_mode FROM store LIMIT 1`);
  if (!row) return undefined;
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    priceMode: row.price_mode === 'tax_exclusive' ? 'tax_exclusive' : 'tax_inclusive',
  };
}

export interface TaxRateRow {
  id: string;
  taxCategoryId: string;
  name: string;
  rateBp: number;
}

export function listTaxRates(driver: SqlDriver): TaxRateRow[] {
  return driver
    .all<{ id: string; tax_category_id: string; name: string; rate_bp: number }>(
      `SELECT id, tax_category_id, name, rate_bp FROM tax_rates`,
    )
    .map((r) => ({ id: r.id, taxCategoryId: r.tax_category_id, name: r.name, rateBp: r.rate_bp }));
}

/** Tax rates keyed by tax category — the Sell screen resolves a variant's rates. */
export function taxRatesByCategory(driver: SqlDriver): Map<string, TaxRateRow[]> {
  const map = new Map<string, TaxRateRow[]>();
  for (const rate of listTaxRates(driver)) {
    const list = map.get(rate.taxCategoryId) ?? [];
    list.push(rate);
    map.set(rate.taxCategoryId, list);
  }
  return map;
}

export interface CategoryRow {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
}

export function listCategories(driver: SqlDriver): CategoryRow[] {
  return driver
    .all<{ id: string; parent_id: string | null; name: string; sort: number }>(
      `SELECT id, parent_id, name, sort FROM categories ORDER BY sort, name`,
    )
    .map((r) => ({ id: r.id, parentId: r.parent_id, name: r.name, sort: r.sort }));
}

/** A sellable unit for the grid: one row per variant, joined to its product. */
export interface SellableVariant {
  variantId: string;
  productId: string;
  productName: string;
  categoryId: string | null;
  taxCategoryId: string;
  optionValues: Record<string, string>;
  sku: string | null;
  priceAmount: number;
  trackStock: boolean;
  onHand: number;
}

interface SellableRow {
  variant_id: string;
  product_id: string;
  product_name: string;
  category_id: string | null;
  tax_category_id: string;
  option_values: string;
  sku: string | null;
  price_amount: number;
  track_stock: number;
  on_hand: number | null;
}

const SELLABLE_SELECT = `
  SELECT v.id AS variant_id, v.product_id AS product_id, p.name AS product_name,
         p.category_id AS category_id, p.tax_category_id AS tax_category_id,
         v.option_values AS option_values, v.sku AS sku, v.price_amount AS price_amount,
         v.track_stock AS track_stock,
         (SELECT COALESCE(SUM(il.on_hand), 0) FROM inventory_levels il WHERE il.variant_id = v.id) AS on_hand
  FROM variants v
  JOIN products p ON p.id = v.product_id
  WHERE p.status = 'active'`;

const toSellable = (row: SellableRow): SellableVariant => ({
  variantId: row.variant_id,
  productId: row.product_id,
  productName: row.product_name,
  categoryId: row.category_id,
  taxCategoryId: row.tax_category_id,
  optionValues: JSON.parse(row.option_values) as Record<string, string>,
  sku: row.sku,
  priceAmount: row.price_amount,
  trackStock: row.track_stock === 1,
  onHand: row.on_hand ?? 0,
});

/** Grid contents, optionally filtered to a category. */
export function listSellableVariants(driver: SqlDriver, categoryId?: string): SellableVariant[] {
  const rows = categoryId
    ? driver.all<SellableRow>(`${SELLABLE_SELECT} AND p.category_id = ? ORDER BY p.name`, [
        categoryId,
      ])
    : driver.all<SellableRow>(`${SELLABLE_SELECT} ORDER BY p.name`);
  return rows.map(toSellable);
}

/** Fuzzy-ish search on product name or variant SKU (LIKE, case-insensitive). */
export function searchSellableVariants(driver: SqlDriver, term: string, limit = 50): SellableVariant[] {
  const like = `%${term.trim()}%`;
  return driver
    .all<SellableRow>(
      `${SELLABLE_SELECT} AND (p.name LIKE ? COLLATE NOCASE OR v.sku LIKE ? COLLATE NOCASE)
       ORDER BY p.name LIMIT ?`,
      [like, like, limit],
    )
    .map(toSellable);
}

/** Barcode scan → the matching sellable variant, or undefined. */
export function lookupBarcode(driver: SqlDriver, code: string): SellableVariant | undefined {
  const row = driver.get<SellableRow>(
    `${SELLABLE_SELECT} AND v.id = (SELECT b.variant_id FROM barcodes b WHERE b.code = ? LIMIT 1)`,
    [code],
  );
  return row ? toSellable(row) : undefined;
}

export interface OrderSummary {
  id: string;
  number: string;
  staffId: string | null;
  state: string;
  currency: string;
  totalAmount: number;
  clientCreatedAt: string;
}

interface OrderRow {
  id: string;
  number: string;
  staff_id: string | null;
  state: string;
  currency: string;
  total_amount: number;
  client_created_at: string;
}

const toOrderSummary = (row: OrderRow): OrderSummary => ({
  id: row.id,
  number: row.number,
  staffId: row.staff_id,
  state: row.state,
  currency: row.currency,
  totalAmount: row.total_amount,
  clientCreatedAt: row.client_created_at,
});

/** POS-07 history — newest first, optional number/date substring search. */
export function listRecentOrders(
  driver: SqlDriver,
  opts: { search?: string; limit?: number } = {},
): OrderSummary[] {
  const limit = opts.limit ?? 100;
  const search = opts.search?.trim();
  const rows = search
    ? driver.all<OrderRow>(
        `SELECT id, number, staff_id, state, currency, total_amount, client_created_at
         FROM orders
         WHERE number LIKE ? COLLATE NOCASE OR client_created_at LIKE ?
         ORDER BY client_created_at DESC LIMIT ?`,
        [`%${search}%`, `%${search}%`, limit],
      )
    : driver.all<OrderRow>(
        `SELECT id, number, staff_id, state, currency, total_amount, client_created_at
         FROM orders ORDER BY client_created_at DESC LIMIT ?`,
        [limit],
      );
  return rows.map(toOrderSummary);
}

export interface OrderLineDetail {
  id: string;
  variantId: string | null;
  name: string;
  qty: number;
  unitPriceAmount: number;
  discounts: unknown[];
  taxLines: { rateId: string; amount: number }[];
  totalAmount: number;
  /** cumulative units already refunded across all refunds (derived) */
  refundedQty: number;
}

export interface PaymentDetail {
  id: string;
  tenderType: string;
  amount: number;
  changeAmount: number;
  cardRef: string | null;
  cardLast4: string | null;
}

export interface RefundDetail {
  id: string;
  totalAmount: number;
  taxAmount: number;
  tenderType: string;
  clientCreatedAt: string;
}

export interface OrderDetail extends OrderSummary {
  subtotalAmount: number;
  discountAmount: number;
  taxAmount: number;
  taxLines: { rateId: string; amount: number }[];
  note: string | null;
  lines: OrderLineDetail[];
  payments: PaymentDetail[];
  refunds: RefundDetail[];
}

/** Full order for POS-07 detail / POS-08 refund, with per-line refunded qty. */
export function getOrderDetail(driver: SqlDriver, orderId: string): OrderDetail | undefined {
  const order = driver.get<
    OrderRow & {
      subtotal_amount: number;
      discount_amount: number;
      tax_amount: number;
      tax_lines: string;
      note: string | null;
    }
  >(
    `SELECT id, number, staff_id, state, currency, total_amount, client_created_at,
            subtotal_amount, discount_amount, tax_amount, tax_lines, note
     FROM orders WHERE id = ?`,
    [orderId],
  );
  if (!order) return undefined;

  const refundedByLine = new Map<string, number>();
  for (const rl of driver.all<{ order_line_id: string; n: number }>(
    `SELECT order_line_id, COALESCE(SUM(qty), 0) AS n
     FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
     WHERE r.order_id = ? GROUP BY order_line_id`,
    [orderId],
  )) {
    refundedByLine.set(rl.order_line_id, rl.n);
  }

  const lines = driver
    .all<{
      id: string;
      variant_id: string | null;
      name: string;
      qty: number;
      unit_price_amount: number;
      discounts: string;
      tax_lines: string;
      total_amount: number;
    }>(
      `SELECT id, variant_id, name, qty, unit_price_amount, discounts, tax_lines, total_amount
       FROM order_lines WHERE order_id = ?`,
      [orderId],
    )
    .map((r) => ({
      id: r.id,
      variantId: r.variant_id,
      name: r.name,
      qty: r.qty,
      unitPriceAmount: r.unit_price_amount,
      discounts: JSON.parse(r.discounts) as unknown[],
      taxLines: JSON.parse(r.tax_lines) as { rateId: string; amount: number }[],
      totalAmount: r.total_amount,
      refundedQty: refundedByLine.get(r.id) ?? 0,
    }));

  const payments = driver
    .all<{
      id: string;
      tender_type: string;
      amount: number;
      change_amount: number;
      card_ref: string | null;
      card_last4: string | null;
    }>(
      `SELECT id, tender_type, amount, change_amount, card_ref, card_last4
       FROM payments WHERE order_id = ?`,
      [orderId],
    )
    .map((r) => ({
      id: r.id,
      tenderType: r.tender_type,
      amount: r.amount,
      changeAmount: r.change_amount,
      cardRef: r.card_ref,
      cardLast4: r.card_last4,
    }));

  const refunds = driver
    .all<{
      id: string;
      total_amount: number;
      tax_amount: number;
      tender_type: string;
      client_created_at: string;
    }>(
      `SELECT id, total_amount, tax_amount, tender_type, client_created_at
       FROM refunds WHERE order_id = ? ORDER BY client_created_at`,
      [orderId],
    )
    .map((r) => ({
      id: r.id,
      totalAmount: r.total_amount,
      taxAmount: r.tax_amount,
      tenderType: r.tender_type,
      clientCreatedAt: r.client_created_at,
    }));

  return {
    ...toOrderSummary(order),
    subtotalAmount: order.subtotal_amount,
    discountAmount: order.discount_amount,
    taxAmount: order.tax_amount,
    taxLines: JSON.parse(order.tax_lines) as { rateId: string; amount: number }[],
    note: order.note,
    lines,
    payments,
    refunds,
  };
}
