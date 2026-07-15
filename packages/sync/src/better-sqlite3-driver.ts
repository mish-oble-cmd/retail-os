import type { SqlDriver } from './driver.js';

/**
 * better-sqlite3 adapter. Loaded lazily so importing @retailos/sync never
 * pulls the native module into environments that don't have it (browser
 * pos-web builds) — better-sqlite3 is an optional peer dependency.
 */
export async function openBetterSqliteDriver(path: string): Promise<SqlDriver> {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  let txDepth = 0;
  return {
    run(sql, params = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    all<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
    get<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).get(...(params as unknown[])) as T | undefined;
    },
    tx<T>(fn: () => T): T {
      if (txDepth > 0) return fn(); // join the outer transaction
      txDepth += 1;
      try {
        db.exec('BEGIN IMMEDIATE');
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.inTransaction) db.exec('ROLLBACK');
        throw error;
      } finally {
        txDepth -= 1;
      }
    },
    close() {
      db.close();
    },
  };
}
