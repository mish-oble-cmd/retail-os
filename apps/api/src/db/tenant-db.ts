import { sql } from 'drizzle-orm';

/**
 * Tenancy guard (FR-10.4, security-and-compliance.md). Every data access goes
 * through one of two doors:
 *
 * - `forStore(storeId).tx(fn)` — the transaction sets `app.store_id`, and the
 *   RLS policies (see migrations) make Postgres itself scope every read and
 *   write to that store. There is no way to touch another tenant's rows from
 *   inside, no matter what SQL the callback builds.
 * - `dangerouslyCrossTenant(fn)` — switches to the BYPASSRLS role for the
 *   transaction. Only identity flows (signup before a store exists, login by
 *   email) may use it; each call site must justify itself in review.
 */

/** Structural subset of a Drizzle Postgres database that both node-postgres and PGlite drivers satisfy. */
export interface DrizzleLike {
  transaction<T>(fn: (tx: TxLike) => Promise<T>): Promise<T>;
  // why any: drizzle's transaction type is driver-specific; the wrapper only needs `execute`
  // and passes the tx through to callers typed as TxLike.
}

export interface TxLike {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
}

export class TenantContext<Tx extends TxLike> {
  constructor(
    private readonly db: { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> },
    readonly storeId: string,
  ) {}

  /** Run `fn` with RLS scoped to this store. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      // SET LOCAL ROLE first: RLS only binds non-superusers, and the dev
      // DATABASE_URL connects as the bootstrap superuser. Without this drop,
      // policies silently stop applying and reads leak across tenants (found
      // live in 1A verification: a two-store dev DB returned the other
      // store's currency). Tests do the same via the pglite harness.
      await tx.execute(sql`SET LOCAL ROLE retailos_app`);
      // set_config(..., true) is transaction-local: no leakage across pooled connections.
      await tx.execute(sql`SELECT set_config('app.store_id', ${this.storeId}, true)`);
      return fn(tx);
    });
  }
}

export class TenantAwareDb<Tx extends TxLike> {
  constructor(private readonly db: { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> }) {}

  forStore(storeId: string): TenantContext<Tx> {
    if (!storeId) throw new Error('forStore requires a store id');
    return new TenantContext(this.db, storeId);
  }

  /**
   * DANGER: bypasses row-level security for the duration of the transaction.
   * Allowed only where no tenant context can exist yet (signup, login-by-email,
   * platform admin jobs). Every new call site needs an explicit justification.
   */
  async dangerouslyCrossTenant<T>(justification: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!justification.trim()) {
      throw new Error('dangerouslyCrossTenant requires a justification string');
    }
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE retailos_admin`);
      return fn(tx);
    });
  }
}
