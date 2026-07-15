import { ulid } from 'ulid';
import type { SqlDriver } from './driver.js';

/**
 * Parked carts (1C, FR-1.7): named holds for an in-progress sale, device-local
 * and per-register. They survive app restarts (persisted in SQLite) but never
 * enter the sync outbox — a parked cart is not yet a sale. The `cart` column is
 * an opaque JSON snapshot the Sell screen re-hydrates on retrieve.
 */

export interface ParkCartInput {
  /** id is optional — a fresh ULID is minted when absent */
  id?: string;
  name: string;
  staffId?: string | null;
  /** opaque cart snapshot (lines, discounts, customer) the UI serializes */
  cart: unknown;
  itemCount: number;
  totalAmount: number;
  currency: string;
}

export interface ParkedCartSummary {
  id: string;
  name: string;
  staffId: string | null;
  itemCount: number;
  totalAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ParkedCart<T = unknown> extends ParkedCartSummary {
  cart: T;
}

interface ParkedRow {
  id: string;
  name: string;
  staff_id: string | null;
  cart: string;
  item_count: number;
  total_amount: number;
  currency: string;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();

const toSummary = (row: ParkedRow): ParkedCartSummary => ({
  id: row.id,
  name: row.name,
  staffId: row.staff_id,
  itemCount: row.item_count,
  totalAmount: row.total_amount,
  currency: row.currency,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Parks a cart (insert) or updates an existing hold when `id` is supplied. */
export function parkCart(driver: SqlDriver, input: ParkCartInput): string {
  const id = input.id ?? ulid();
  const timestamp = now();
  driver.run(
    `INSERT INTO parked_carts (id, name, staff_id, cart, item_count, total_amount, currency, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       staff_id = excluded.staff_id,
       cart = excluded.cart,
       item_count = excluded.item_count,
       total_amount = excluded.total_amount,
       currency = excluded.currency,
       updated_at = excluded.updated_at`,
    [
      id,
      input.name,
      input.staffId ?? null,
      JSON.stringify(input.cart),
      input.itemCount,
      input.totalAmount,
      input.currency,
      timestamp,
      timestamp,
    ],
  );
  return id;
}

/** Newest first — POS-06 lists holds by recency. */
export function listParkedCarts(driver: SqlDriver): ParkedCartSummary[] {
  return driver
    .all<ParkedRow>(
      `SELECT id, name, staff_id, cart, item_count, total_amount, currency, created_at, updated_at
       FROM parked_carts ORDER BY updated_at DESC`,
    )
    .map(toSummary);
}

/** Reads a hold with its cart snapshot re-hydrated; undefined when missing. */
export function getParkedCart<T = unknown>(
  driver: SqlDriver,
  id: string,
): ParkedCart<T> | undefined {
  const row = driver.get<ParkedRow>(
    `SELECT id, name, staff_id, cart, item_count, total_amount, currency, created_at, updated_at
     FROM parked_carts WHERE id = ?`,
    [id],
  );
  if (!row) return undefined;
  return { ...toSummary(row), cart: JSON.parse(row.cart) as T };
}

/**
 * Retrieves and removes a hold in one tx (retrieve = resume selling), returning
 * its snapshot. Returns undefined if it was already retrieved/discarded.
 */
export function retrieveParkedCart<T = unknown>(
  driver: SqlDriver,
  id: string,
): ParkedCart<T> | undefined {
  return driver.tx(() => {
    const cart = getParkedCart<T>(driver, id);
    if (!cart) return undefined;
    driver.run(`DELETE FROM parked_carts WHERE id = ?`, [id]);
    return cart;
  });
}

export function discardParkedCart(driver: SqlDriver, id: string): void {
  driver.run(`DELETE FROM parked_carts WHERE id = ?`, [id]);
}
