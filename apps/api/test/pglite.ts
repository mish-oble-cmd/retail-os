import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema';
import { TenantAwareDb } from '../src/db/tenant-db';

/**
 * Test database: PGlite (real Postgres in WASM) — no Docker needed, works in
 * CI. The Phase 0 substitution for Testcontainers is recorded in
 * 07-development/testing-strategy.md; the SQL under test is identical.
 *
 * PGlite connects as a superuser, and superusers always bypass RLS — so the
 * returned `appDb` wrapper pins every transaction to the non-privileged
 * `retailos_app` role first, exactly matching how production connects.
 */
export async function createTestDb() {
  const pglite = new PGlite();
  const raw = drizzle(pglite, { schema });

  const migrationsDir = join(__dirname, '..', 'src', 'db', 'migrations');
  for (const file of readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await pglite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  }

  type Tx = Parameters<Parameters<PgliteDatabase<typeof schema>['transaction']>[0]>[0];
  const appDb = {
    transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return raw.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE retailos_app`);
        return fn(tx);
      });
    },
  };

  return {
    tenants: new TenantAwareDb<Tx>(appDb),
    /** App-role transaction WITHOUT tenant context — for proving "no context, no rows". */
    appTx: <T>(fn: (tx: Tx) => Promise<T>) => appDb.transaction(fn),
    close: () => pglite.close(),
  };
}
