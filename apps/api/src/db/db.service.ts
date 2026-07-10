import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { TenantAwareDb } from './tenant-db';

/**
 * Connection owner. Pools lazily — the app boots (health endpoint, OpenAPI
 * generation) without a reachable database.
 */

/** Transaction handle services receive inside `tenants.forStore(...).tx()`. */
export type TenantTx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;
  readonly drizzle: NodePgDatabase<typeof schema>;
  readonly tenants: TenantAwareDb<TenantTx>;

  constructor() {
    this.pool = new Pool({
      connectionString:
        process.env['DATABASE_URL'] ?? 'postgres://retailos:retailos@localhost:5432/retailos',
    });
    this.drizzle = drizzle(this.pool, { schema });
    this.tenants = new TenantAwareDb(this.drizzle);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
