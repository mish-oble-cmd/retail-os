/**
 * Storage abstraction for the device database. Synchronous by design:
 * better-sqlite3 is synchronous, and synchronous transactions are what make
 * the outbox atomicity guarantee (fact rows + outbox entry in ONE tx —
 * offline-sync-strategy.md §Client anatomy) easy to reason about.
 *
 * Adapters: better-sqlite3 (Electron/desktop, tests) ships here; the RN and
 * wa-sqlite adapters arrive with their platforms (Phase 3).
 */
export interface SqlDriver {
  run(sql: string, params?: readonly unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): T | undefined;
  /** BEGIN IMMEDIATE … COMMIT, rolls back if fn throws. Nested calls join the outer tx. */
  tx<T>(fn: () => T): T;
  close(): void;
}
