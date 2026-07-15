import type { SqlDriver } from './driver.js';

/**
 * sql.js (SQLite compiled to wasm) adapter — the browser POS engine (1C).
 * sql.js is fully synchronous once its wasm is initialized, so it satisfies the
 * synchronous `SqlDriver` contract exactly (unlike an async OPFS VFS). Durable
 * persistence is layered on top as a best-effort snapshot: after each top-level
 * commit the whole database is exported and handed to `onPersist` (the OPFS
 * writer in the browser). This matches offline-sync-strategy.md's stance that
 * browser pos-web is online-preferred, not certified for extended offline —
 * certified offline stays Electron (better-sqlite3) + RN.
 *
 * Loaded lazily so Node/Electron builds that use better-sqlite3 never pull the
 * wasm module.
 */

export interface SqlJsDriverOptions {
  /** existing database bytes to open (e.g. loaded from OPFS); omit for fresh */
  data?: Uint8Array;
  /** resolves the wasm asset URL (Vite passes an imported ?url); Node defaults work */
  locateFile?: (file: string) => string;
  /** invoked (coalesced) after each top-level commit with a full DB snapshot */
  onPersist?: (bytes: Uint8Array) => void;
}

export interface SqlJsDriver extends SqlDriver {
  /** current database as bytes — the persistence snapshot */
  export(): Uint8Array;
}

// One wasm init per process; sql.js is a singleton runtime.
let runtime: Promise<import('sql.js').SqlJsStatic> | null = null;

function loadRuntime(locateFile?: (file: string) => string): Promise<import('sql.js').SqlJsStatic> {
  if (!runtime) {
    runtime = import('sql.js').then(({ default: initSqlJs }) =>
      initSqlJs(locateFile ? { locateFile } : undefined),
    );
  }
  return runtime;
}

export async function openSqlJsDriver(opts: SqlJsDriverOptions = {}): Promise<SqlJsDriver> {
  const SQL = await loadRuntime(opts.locateFile);
  const db = new SQL.Database(opts.data);
  db.run('PRAGMA foreign_keys = ON');

  let txDepth = 0;
  let persistScheduled = false;
  const schedulePersist = () => {
    if (!opts.onPersist || persistScheduled) return;
    persistScheduled = true;
    // Coalesce a burst of commits into a single export on the next microtask.
    queueMicrotask(() => {
      persistScheduled = false;
      opts.onPersist?.(db.export());
    });
  };
  const bind = (params: readonly unknown[]) => params as import('sql.js').BindParams;

  return {
    run(sql, params = []) {
      db.run(sql, bind(params));
      if (txDepth === 0) schedulePersist();
    },
    all<T>(sql: string, params: readonly unknown[] = []) {
      const stmt = db.prepare(sql, bind(params));
      const rows: T[] = [];
      try {
        while (stmt.step()) rows.push(stmt.getAsObject() as T);
      } finally {
        stmt.free();
      }
      return rows;
    },
    get<T>(sql: string, params: readonly unknown[] = []) {
      const stmt = db.prepare(sql, bind(params));
      try {
        return stmt.step() ? (stmt.getAsObject() as T) : undefined;
      } finally {
        stmt.free();
      }
    },
    tx<T>(fn: () => T): T {
      if (txDepth > 0) return fn(); // join the outer transaction
      txDepth += 1;
      try {
        db.run('BEGIN IMMEDIATE');
        const result = fn();
        db.run('COMMIT');
        return result;
      } catch (error) {
        try {
          db.run('ROLLBACK');
        } catch {
          // not in a transaction — nothing to roll back
        }
        throw error;
      } finally {
        txDepth -= 1;
        if (txDepth === 0) schedulePersist();
      }
    },
    export() {
      return db.export();
    },
    close() {
      db.close();
    },
  };
}
