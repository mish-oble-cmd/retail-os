# Workstream 1B — POS Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A register device can activate with a one-time code, download a catalog/settings snapshot into local SQLite, stay current via a delta feed, and push locally-recorded sale facts through an atomic outbox with idempotent replay (`/sync/activate`, `/sync/bootstrap`, `/sync/changes`, `/sync/batches`).

**Architecture:** Server side lives in `apps/api/src/modules/sync` (NestJS, Drizzle, RLS-scoped via `db.tenants.forStore()`); the delta feed rides the existing per-store `sync_rev` counter (`bump_sync_rev` trigger, `0001_catalog.sql`). Client side is `@retailos/sync`: a driver-agnostic engine (better-sqlite3 adapter for Electron/tests) with mirror tables, facts tables, and an outbox written in the same SQLite transaction as the fact — the atomicity guarantee from `03-architecture/offline-sync-strategy.md`.

**Tech Stack:** NestJS + Drizzle + PGlite (tests), zod DTOs, `@retailos/domain` for ingest revalidation, better-sqlite3, Vitest.

## Global Constraints

- Money is integers (minor units); tax rates are integer basis points — never floats (CLAUDE.md rule 5)
- Every business table carries `store_id`; intra-tenant FKs are composite `(store_id, id)`; RLS ENABLED + FORCED + `tenant_isolation` policy on every new table (see `0001_catalog.sql`)
- `retailos_app` role gets least-privilege grants; facts tables are append-only (no UPDATE/DELETE grant except `orders` UPDATE for server-set state transitions — data-model.md invariant 4)
- IDs are ULIDs (`ulid` package server-side; client generates ULIDs too)
- TypeScript strict; no `any` without `// why:` comment
- Golden rule: **a completed sale is NEVER rejected** — divergence becomes a `sync_conflicts` row, the fact still persists
- Idempotency: batch replays dedupe on `(store_id, batch_id)`; fact replays dedupe on entity ULID; both must be covered by replay tests (testing-strategy.md)
- Commits: conventional, suffixed `(1B)`, e.g. `feat(api): device activation exchange (1B)`
- Run tests with `pnpm --filter @retailos/api test` / `pnpm --filter @retailos/sync test`; full gate is `pnpm turbo typecheck lint test`

## Decisions this plan records in docs (Task 1)

Proposed by AI per the Phase-1 kickoff pattern ("standing unless vetoed by user"):

1. **Device auth**: `POST /api/v1/sync/activate` exchanges `{ code }` → `{ device_token, store_id, register_id, location_id }`. Token = `rot_` + 32 random bytes base64url, shown once; only its sha-256 hex is stored in a new `devices` table. Sync endpoints authenticate with `Authorization: Bearer rot_…`. Lookup by token hash is cross-tenant (`dangerouslyCrossTenant`, same justification class as login-by-email). `activation_codes.code_hash` becomes globally unique so an 8-char code is never ambiguous across stores.
2. **Deletions sync via tombstones**: new `sync_tombstones` table `(store_id, entity_type, entity_id, sync_rev, deleted_at)`; an `AFTER DELETE` trigger on every ⬇-synced table writes one; the delta feed emits them as `{ type: "tombstone" }` changes. (Today only categories hard-delete, but the trigger goes on all synced tables.)
3. **Phase-0 tables join the delta feed**: `stores`, `locations`, `registers`, `staff`, `roles` gain `sync_rev` + triggers. `stores` bumps itself in-row (`NEW.sync_seq + 1`) guarded by `pg_trigger_depth() = 0` so counter bumps from other tables' triggers don't churn the store row. Staff sync down is a **projection**: `id, name, role_id, pin_hash, active` only — never `password_hash`/`totp_*` (data-model.md already mandates this).
4. **Facts storage lands now**: `orders`, `order_lines`, `payments` tables (subset of data-model.md §Order needed for `order.completed` facts), plus `sync_batches` (batch dedupe + stored acks) and `sync_conflicts`. Refund/shift facts arrive with 1C/1D.
5. **Ingest revalidation v1**: recompute totals with `@retailos/domain` `calculateCart` using server tax rates; mismatch → `total_mismatch` conflict (fact still accepted); unknown rate id → `stale_reference` conflict, revalidation skipped. Full conflict matrix stays Phase 3.
6. **Client token storage is pluggable**: `@retailos/sync` persists the device token via an injected `SecretStore`; default SQLite-backed store for tests/dev, OS-keychain adapter arrives with the Electron wiring in 1C. better-sqlite3 is a lazy-loaded optional peer dep (+ devDep for tests) so browser builds never touch it.
7. **Known delta-feed race** (rev handed out by a not-yet-committed transaction can be skipped by a concurrent pull) is accepted for Phase 1 volume and documented; Phase 3 hardening revisits (single-writer per store today).
8. **Customers are excluded from bootstrap/changes until Phase 2** (no customers table exists yet); the strategy doc's "catalog+settings+customers" snapshot is amended with a phase note.

## File structure

```
apps/api/src/db/migrations/0003_sync.sql        — devices, tombstones, facts, sync_rev backfill
apps/api/src/db/schema.ts                        — add new tables (modify)
apps/api/src/modules/sync/dto.ts                 — zod schemas for activate + batches
apps/api/src/modules/sync/devices.service.ts     — code exchange, token auth
apps/api/src/modules/sync/sync.service.ts        — bootstrap, changes, batch ingest
apps/api/src/modules/sync/sync.controller.ts     — the four endpoints
apps/api/src/modules/sync/sync.module.ts         — wire up (modify)
apps/api/test/sync-schema.test.ts                — migration behavior
apps/api/test/devices.service.test.ts
apps/api/test/sync.service.test.ts

packages/sync/src/driver.ts                      — SqlDriver interface
packages/sync/src/better-sqlite3-driver.ts       — lazy adapter
packages/sync/src/schema.ts                      — device SQLite DDL + migrate()
packages/sync/src/http.ts                        — SyncHttp (fetch wrapper)
packages/sync/src/apply.ts                       — change/bootstrap application
packages/sync/src/outbox.ts                      — recordSale/recordStockMovement + claim/mark
packages/sync/src/client.ts                      — SyncClient facade (activate/bootstrap/pull/push/sync/status)
packages/sync/src/index.ts                       — exports (replace stub)
packages/sync/test/fake-server.ts                — in-memory server for engine tests
packages/sync/test/{schema,apply,outbox,client}.test.ts
packages/sync/vitest.config.ts, package.json     — test wiring (modify)
```

---

### Task 1: Record 1B decisions in the docs

**Files:**
- Modify: `05-roadmap/phase-1-core-pos-mvp.md` (add "1B kickoff decisions (2026-07-11)" subsection under §1B listing decisions 1–8 above, one line each)
- Modify: `03-architecture/api-design.md` (add `/sync/activate POST (activation code → device token)` to the endpoint list next to the other `/sync/*` lines)
- Modify: `03-architecture/offline-sync-strategy.md` (under "Register activation & trust": token format + `devices` table + global code-hash uniqueness; new short "Deltas & deletions" paragraph: tombstones, Phase-0 table sync_rev note, the accepted pull race; amend Bootstrap line with "customers join in Phase 2")
- Modify: `03-architecture/data-model.md` (§sync additions: `devices`, `sync_batches`, `sync_conflicts`, `sync_tombstones` one-liners under a "Sync plumbing (1B)" heading)

- [ ] **Step 1: Write the doc edits** (content = decisions section above, adapted to each doc's voice; keep each addition under ~15 lines)
- [ ] **Step 2: Commit**

```bash
git add 05-roadmap/phase-1-core-pos-mvp.md 03-architecture/*.md
git commit -m "docs: 1B kickoff decisions — device auth, tombstones, facts tables, ingest revalidation v1 (1B)"
```

---

### Task 2: Migration 0003 + Drizzle schema

**Files:**
- Create: `apps/api/src/db/migrations/0003_sync.sql`
- Modify: `apps/api/src/db/schema.ts`
- Test: `apps/api/test/sync-schema.test.ts`

**Interfaces (produces):** tables `devices`, `sync_tombstones`, `orders`, `order_lines`, `payments`, `sync_batches`, `sync_conflicts`; `sync_rev` on `stores/locations/registers/staff/roles`; Drizzle exports `devices, syncTombstones, orders, orderLines, payments, syncBatches, syncConflicts` with camelCase columns mirroring the SQL below.

- [ ] **Step 1: Write failing schema test** `apps/api/test/sync-schema.test.ts`

```ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './pglite';

describe('0003_sync migration', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => { db = await createTestDb(); });
  afterAll(async () => { await db.close(); });

  const seed = async (storeId: string) => {
    await db.appTx(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE retailos_admin`);
      await tx.execute(sql`INSERT INTO stores (id, name, currency) VALUES (${storeId}, 's', 'SGD')`);
    });
  };

  it('bumps sync_rev on staff and registers writes', async () => {
    await seed('01STORE0000000000000000001');
    const t = db.tenants.forStore('01STORE0000000000000000001');
    await t.tx(async (tx) => {
      await tx.execute(sql`INSERT INTO roles (id, store_id, name) VALUES ('01ROLE0000000000000000001', '01STORE0000000000000000001', 'Owner')`);
      await tx.execute(sql`INSERT INTO staff (id, store_id, name, role_id) VALUES ('01STAFF000000000000000001', '01STORE0000000000000000001', 'A', '01ROLE0000000000000000001')`);
    });
    const rev = await t.tx(async (tx) =>
      tx.execute(sql`SELECT sync_rev FROM staff WHERE id = '01STAFF000000000000000001'`));
    expect(Number((rev as { rows: { sync_rev: string }[] }).rows[0].sync_rev)).toBeGreaterThan(0);
  });

  it('store settings update bumps stores.sync_rev; catalog writes do not churn it', async () => {
    await seed('01STORE0000000000000000002');
    const t = db.tenants.forStore('01STORE0000000000000000002');
    const revOf = async () => Number((await t.tx(async (tx) =>
      tx.execute(sql`SELECT sync_rev FROM stores WHERE id = '01STORE0000000000000000002'`)) as { rows: { sync_rev: string }[] }).rows[0].sync_rev);
    const before = await revOf();
    await t.tx(async (tx) =>
      tx.execute(sql`INSERT INTO tax_categories (id, store_id, name) VALUES ('01TAXC0000000000000000001', '01STORE0000000000000000002', 'Std')`));
    expect(await revOf()).toBe(before); // nested counter bump must not touch the store row's own rev
    await t.tx(async (tx) =>
      tx.execute(sql`UPDATE stores SET name = 's2' WHERE id = '01STORE0000000000000000002'`));
    expect(await revOf()).toBeGreaterThan(before);
  });

  it('deleting a category writes a tombstone with a fresh sync_rev', async () => {
    await seed('01STORE0000000000000000003');
    const t = db.tenants.forStore('01STORE0000000000000000003');
    await t.tx(async (tx) => {
      await tx.execute(sql`INSERT INTO categories (id, store_id, name) VALUES ('01CAT00000000000000000001', '01STORE0000000000000000003', 'Snacks')`);
      await tx.execute(sql`DELETE FROM categories WHERE id = '01CAT00000000000000000001'`);
    });
    const rows = (await t.tx(async (tx) =>
      tx.execute(sql`SELECT entity_type, entity_id, sync_rev FROM sync_tombstones`)) as
      { rows: { entity_type: string; entity_id: string; sync_rev: string }[] }).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entity_type: 'category', entity_id: '01CAT00000000000000000001' });
    expect(Number(rows[0].sync_rev)).toBeGreaterThan(0);
  });

  it('facts tables are append-only for retailos_app (no UPDATE on order_lines)', async () => {
    await seed('01STORE0000000000000000004');
    const t = db.tenants.forStore('01STORE0000000000000000004');
    await expect(t.tx(async (tx) =>
      tx.execute(sql`UPDATE order_lines SET name = 'x'`))).rejects.toThrow(/permission denied/);
  });

  it('RLS: no tenant context, no tombstone rows', async () => {
    const rows = (await db.appTx(async (tx) =>
      tx.execute(sql`SELECT * FROM sync_tombstones`)) as { rows: unknown[] }).rows;
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @retailos/api test -- sync-schema` → FAIL (`relation "sync_tombstones" does not exist`)

- [ ] **Step 3: Write `apps/api/src/db/migrations/0003_sync.sql`**

```sql
-- Phase 1 / workstream 1B: sync plumbing (docs: offline-sync-strategy.md,
-- data-model.md §Sync plumbing, plan docs/superpowers/plans/2026-07-11-1b-pos-data-layer.md).

-- ---- Phase-0 tables join the delta feed ------------------------------------

ALTER TABLE stores    ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE locations ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE registers ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE staff     ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;
ALTER TABLE roles     ADD COLUMN sync_rev bigint NOT NULL DEFAULT 0;

CREATE TRIGGER locations_sync_rev BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER registers_sync_rev BEFORE INSERT OR UPDATE ON registers
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER staff_sync_rev BEFORE INSERT OR UPDATE ON staff
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();
CREATE TRIGGER roles_sync_rev BEFORE INSERT OR UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();

-- roles has no store-scoped rev index yet; add rev indexes for the feed.
CREATE INDEX locations_store_rev_idx ON locations (store_id, sync_rev);
CREATE INDEX registers_store_rev_idx ON registers (store_id, sync_rev);
CREATE INDEX staff_store_rev_idx     ON staff (store_id, sync_rev);
CREATE INDEX roles_store_rev_idx     ON roles (store_id, sync_rev);

-- stores bumps itself in-row. pg_trigger_depth() guard: bump_sync_rev on the
-- OTHER tables performs `UPDATE stores SET sync_seq = …` (depth 1); without
-- the guard every catalog write would churn the store row into the delta feed.
CREATE FUNCTION bump_store_sync_rev() RETURNS trigger AS $$
BEGIN
  NEW.sync_seq := NEW.sync_seq + 1;
  NEW.sync_rev := NEW.sync_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stores_sync_rev BEFORE INSERT OR UPDATE ON stores
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION bump_store_sync_rev();

-- ---- Tombstones (deletions flow down the delta feed) ------------------------

CREATE TABLE sync_tombstones (
  store_id text NOT NULL REFERENCES stores(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  sync_rev bigint NOT NULL DEFAULT 0,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, entity_type, entity_id)
);
CREATE INDEX sync_tombstones_store_rev_idx ON sync_tombstones (store_id, sync_rev);

CREATE TRIGGER sync_tombstones_sync_rev BEFORE INSERT OR UPDATE ON sync_tombstones
  FOR EACH ROW EXECUTE FUNCTION bump_sync_rev();

CREATE FUNCTION write_sync_tombstone() RETURNS trigger AS $$
BEGIN
  INSERT INTO sync_tombstones (store_id, entity_type, entity_id)
  VALUES (OLD.store_id, TG_ARGV[0], OLD.id)
  ON CONFLICT (store_id, entity_type, entity_id)
    DO UPDATE SET deleted_at = now(), sync_rev = DEFAULT;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER categories_tombstone       AFTER DELETE ON categories       FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('category');
CREATE TRIGGER products_tombstone         AFTER DELETE ON products         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('product');
CREATE TRIGGER variants_tombstone         AFTER DELETE ON variants         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('variant');
CREATE TRIGGER barcodes_tombstone         AFTER DELETE ON barcodes         FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('barcode');
CREATE TRIGGER tax_categories_tombstone   AFTER DELETE ON tax_categories   FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('tax_category');
CREATE TRIGGER tax_rates_tombstone        AFTER DELETE ON tax_rates        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('tax_rate');
CREATE TRIGGER inventory_levels_tombstone AFTER DELETE ON inventory_levels FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('inventory_level');
CREATE TRIGGER locations_tombstone        AFTER DELETE ON locations        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('location');
CREATE TRIGGER registers_tombstone        AFTER DELETE ON registers        FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('register');
CREATE TRIGGER staff_tombstone            AFTER DELETE ON staff            FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('staff');
CREATE TRIGGER roles_tombstone            AFTER DELETE ON roles            FOR EACH ROW EXECUTE FUNCTION write_sync_tombstone('role');

-- ---- Devices (register trust; offline-sync-strategy.md §activation) ---------

-- An 8-char code must resolve a device unambiguously without a store id:
ALTER TABLE activation_codes DROP CONSTRAINT IF EXISTS activation_codes_store_hash_unique;
DROP INDEX IF EXISTS activation_codes_store_hash_unique;
CREATE UNIQUE INDEX activation_codes_code_hash_unique ON activation_codes (code_hash);

CREATE TABLE devices (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  token_hash text NOT NULL,
  app_version text,
  activated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_register_fk FOREIGN KEY (store_id, register_id)
    REFERENCES registers (store_id, id)
);
CREATE UNIQUE INDEX devices_token_hash_unique ON devices (token_hash);
CREATE INDEX devices_store_register_idx ON devices (store_id, register_id);

-- ---- Order facts (data-model.md §Order; append-only, invariant 4) -----------

CREATE TABLE orders (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  location_id text NOT NULL,
  staff_id text,
  customer_id text,
  number text NOT NULL,
  state text NOT NULL CHECK (state IN ('completed','partially_paid','refunded','partially_refunded','voided')),
  currency text NOT NULL,
  subtotal_amount bigint NOT NULL,
  discount_amount bigint NOT NULL DEFAULT 0,
  tax_amount bigint NOT NULL DEFAULT 0,
  total_amount bigint NOT NULL,
  tax_lines jsonb NOT NULL DEFAULT '[]',
  note text,
  source text NOT NULL DEFAULT 'pos' CHECK (source IN ('pos','api')),
  client_created_at timestamptz,
  local_seq bigint,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_store_id_unique UNIQUE (store_id, id),
  CONSTRAINT orders_register_fk FOREIGN KEY (store_id, register_id) REFERENCES registers (store_id, id),
  CONSTRAINT orders_location_fk FOREIGN KEY (store_id, location_id) REFERENCES locations (store_id, id),
  CONSTRAINT orders_staff_fk    FOREIGN KEY (store_id, staff_id)    REFERENCES staff (store_id, id)
);
CREATE INDEX orders_store_created_idx ON orders (store_id, client_created_at);
CREATE UNIQUE INDEX orders_register_seq_unique ON orders (store_id, register_id, local_seq)
  WHERE local_seq IS NOT NULL;

CREATE TABLE order_lines (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  order_id text NOT NULL,
  variant_id text,
  name text NOT NULL,
  qty bigint NOT NULL,
  unit_price_amount bigint NOT NULL,
  discounts jsonb NOT NULL DEFAULT '[]',
  tax_lines jsonb NOT NULL DEFAULT '[]',
  total_amount bigint NOT NULL,
  cost_snapshot_amount bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_lines_order_fk   FOREIGN KEY (store_id, order_id)   REFERENCES orders (store_id, id),
  CONSTRAINT order_lines_variant_fk FOREIGN KEY (store_id, variant_id) REFERENCES variants (store_id, id)
);
CREATE INDEX order_lines_store_order_idx ON order_lines (store_id, order_id);

CREATE TABLE payments (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  order_id text NOT NULL,
  tender_type text NOT NULL CHECK (tender_type IN ('cash','card_manual')),
  amount bigint NOT NULL,
  change_amount bigint NOT NULL DEFAULT 0,
  card_ref text,
  card_last4 text,
  captured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_order_fk FOREIGN KEY (store_id, order_id) REFERENCES orders (store_id, id)
);
CREATE INDEX payments_store_order_idx ON payments (store_id, order_id);

-- ---- Batch dedupe + conflicts ------------------------------------------------

CREATE TABLE sync_batches (
  id text NOT NULL,
  store_id text NOT NULL REFERENCES stores(id),
  register_id text NOT NULL,
  device_id text NOT NULL,
  fact_count integer NOT NULL,
  acks jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, id),
  CONSTRAINT sync_batches_register_fk FOREIGN KEY (store_id, register_id) REFERENCES registers (store_id, id)
);

CREATE TABLE sync_conflicts (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES stores(id),
  conflict_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CONSTRAINT sync_conflicts_staff_fk FOREIGN KEY (store_id, resolved_by) REFERENCES staff (store_id, id)
);
CREATE INDEX sync_conflicts_store_open_idx ON sync_conflicts (store_id, created_at) WHERE resolved_at IS NULL;

-- ---- RLS ----------------------------------------------------------------------

ALTER TABLE sync_tombstones ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_tombstones FORCE ROW LEVEL SECURITY;
ALTER TABLE devices         ENABLE ROW LEVEL SECURITY; ALTER TABLE devices         FORCE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY; ALTER TABLE orders          FORCE ROW LEVEL SECURITY;
ALTER TABLE order_lines     ENABLE ROW LEVEL SECURITY; ALTER TABLE order_lines     FORCE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY; ALTER TABLE payments        FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_batches    ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_batches    FORCE ROW LEVEL SECURITY;
ALTER TABLE sync_conflicts  ENABLE ROW LEVEL SECURITY; ALTER TABLE sync_conflicts  FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON sync_tombstones USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON devices         USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON orders          USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON order_lines     USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON payments        USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON sync_batches    USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));
CREATE POLICY tenant_isolation ON sync_conflicts  USING (store_id = current_setting('app.store_id', true)) WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---- Grants (append-only facts; orders may receive server-set state UPDATEs) --

GRANT SELECT, INSERT, UPDATE ON sync_tombstones TO retailos_app;  -- re-delete upserts
GRANT SELECT, INSERT, UPDATE ON devices TO retailos_app;          -- last_seen / revoke
GRANT SELECT, INSERT, UPDATE ON orders TO retailos_app;           -- state transitions only (invariant 4)
GRANT SELECT, INSERT ON order_lines TO retailos_app;
GRANT SELECT, INSERT ON payments TO retailos_app;
GRANT SELECT, INSERT ON sync_batches TO retailos_app;
GRANT SELECT, INSERT, UPDATE ON sync_conflicts TO retailos_app;   -- resolve = UPDATE
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_tombstones, devices, orders, order_lines, payments, sync_batches, sync_conflicts TO retailos_admin;
```

- [ ] **Step 4: Add the same tables to `apps/api/src/db/schema.ts`** — Drizzle definitions mirroring the SQL exactly (camelCase properties, composite FKs via `foreignKey()`, `syncRev` spread on stores/locations/registers/staff/roles). Follow the existing style in the file; `syncTombstones` uses a composite `primaryKey()`.

- [ ] **Step 5: Run the test** — `pnpm --filter @retailos/api test -- sync-schema` → PASS. Also run the full API suite (`pnpm --filter @retailos/api test`) — the new staff/registers triggers touch identity/settings fixtures; fix any fixture fallout (none expected: triggers only stamp `sync_rev`).

- [ ] **Step 6: Commit** — `feat(api): 1B sync schema — devices, tombstones, order facts, batch dedupe, phase-0 sync_rev (1B)`

---

### Task 3: Device activation exchange + bearer auth

**Files:**
- Create: `apps/api/src/modules/sync/devices.service.ts`, `apps/api/src/modules/sync/dto.ts`
- Modify: `apps/api/src/modules/sync/sync.module.ts`, `apps/api/src/app.module.ts` (import SyncModule if not already), `apps/api/src/modules/sync/sync.controller.ts` (created here with just `/sync/activate`; grows in Tasks 4–6)
- Test: `apps/api/test/devices.service.test.ts`

**Interfaces (produces):**
```ts
interface DeviceContext { deviceId: string; storeId: string; registerId: string; locationId: string; }
class DevicesService {
  activate(code: string, appVersion?: string): Promise<{ deviceToken: string; storeId: string; registerId: string; locationId: string }>;
  authenticate(authorizationHeader: string | undefined): Promise<DeviceContext>; // throws UnauthorizedException
  revoke(storeId: string, staffId: string, deviceId: string): Promise<void>;      // admin session; permission 'registers_edit'
}
```

- [ ] **Step 1: Write failing tests** — `apps/api/test/devices.service.test.ts`. Fixture helper seeds store/role/staff/location/register via `retailos_admin` (copy the seeding pattern from `registers.service.test.ts`), then uses the real `RegistersService.issueActivationCode` to get a plaintext code. Cases:
  1. `activate(code)` returns a `rot_…` token + store/register/location ids; the activation code row gets `used_at`; a `devices` row exists with `token_hash = sha256(token)` and no plaintext.
  2. second `activate(same code)` → `UnauthorizedException` (single-use).
  3. expired code (insert one with `expires_at` in the past) → `UnauthorizedException`.
  4. revoked code (`revoked_at` set) → `UnauthorizedException`.
  5. `authenticate('Bearer ' + token)` → correct `DeviceContext`; bumps `last_seen_at`.
  6. `authenticate` with garbage/missing header or after `revoke(...)` → `UnauthorizedException`.
- [ ] **Step 2: Run** → FAIL (module doesn't exist).
- [ ] **Step 3: Implement `devices.service.ts`**

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { DbService } from '../../db/db.service';
import { activationCodes, devices, registers } from '../../db/schema';
import { hashActivationCode } from '../settings/registers.service';

export interface DeviceContext {
  deviceId: string;
  storeId: string;
  registerId: string;
  locationId: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class DevicesService {
  constructor(private readonly db: DbService) {}

  /**
   * Exchange a one-time activation code for a device token. Cross-tenant:
   * the device knows only its 8-char code — code_hash is globally unique
   * (0003), so the lookup is unambiguous. Same justification class as
   * login-by-email (tenant-db.ts).
   */
  async activate(code: string, appVersion?: string) {
    const codeHash = hashActivationCode(code.trim().toUpperCase());
    const token = `rot_${randomBytes(32).toString('base64url')}`;
    const result = await this.db.tenants.dangerouslyCrossTenant(async (tx) => {
      const consumed = await tx
        .update(activationCodes)
        .set({ usedAt: new Date(), updatedAt: new Date() })
        .where(and(
          eq(activationCodes.codeHash, codeHash),
          isNull(activationCodes.usedAt),
          isNull(activationCodes.revokedAt),
          sql`${activationCodes.expiresAt} > now()`,
        ))
        .returning();
      if (consumed.length !== 1) return null;
      const { storeId, registerId } = consumed[0];
      const [register] = await tx.select().from(registers)
        .where(and(eq(registers.storeId, storeId), eq(registers.id, registerId)));
      await tx.insert(devices).values({
        id: ulid(), storeId, registerId, tokenHash: sha256(token), appVersion: appVersion ?? null,
      });
      return { storeId, registerId, locationId: register.locationId };
    });
    if (!result) throw new UnauthorizedException('Activation code is invalid, used, or expired');
    return { deviceToken: token, ...result };
  }

  /** Resolve a sync-endpoint bearer token; bumps last_seen_at. */
  async authenticate(authorizationHeader: string | undefined): Promise<DeviceContext> {
    const token = authorizationHeader?.match(/^Bearer (rot_[A-Za-z0-9_-]+)$/)?.[1];
    if (!token) throw new UnauthorizedException('Device token required');
    const ctx = await this.db.tenants.dangerouslyCrossTenant(async (tx) => {
      const [device] = await tx
        .update(devices)
        .set({ lastSeenAt: new Date(), updatedAt: new Date() })
        .where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt)))
        .returning();
      if (!device) return null;
      const [register] = await tx.select().from(registers)
        .where(and(eq(registers.storeId, device.storeId), eq(registers.id, device.registerId)));
      return {
        deviceId: device.id, storeId: device.storeId,
        registerId: device.registerId, locationId: register.locationId,
      };
    });
    if (!ctx) throw new UnauthorizedException('Unknown or revoked device token');
    return ctx;
  }

  /** Admin revocation (ADM-16). */
  async revoke(storeId: string, staffId: string, deviceId: string): Promise<void> {
    await this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const updated = await tx.update(devices)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
        .returning();
      if (updated.length !== 1) throw new NotFoundException('Device not found or already revoked');
    });
  }
}
```

  (Adjust `dangerouslyCrossTenant` callback signature to the actual helper — check `tenant-db.ts`; if it exposes raw-SQL-only `TxLike`, widen it the way identity.service.ts does.)

- [ ] **Step 4: `dto.ts` (activate part) + controller (activate route only) + module wiring**

```ts
// dto.ts
import { z } from 'zod';
export const activateDeviceSchema = z.object({
  code: z.string().min(8).max(9), // 8 chars, tolerate a hyphen
  app_version: z.string().max(50).optional(),
});
```

```ts
// sync.controller.ts
import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { activateDeviceSchema } from './dto';
import { DevicesService } from './devices.service';

@ApiTags('sync')
@Controller('sync')
export class SyncController {
  constructor(private readonly devices: DevicesService) {}

  @Post('activate')
  @ApiOperation({ operationId: 'activateDevice', summary: 'Exchange a one-time activation code for a device token' })
  async activate(@Body() body: unknown) {
    const input = activateDeviceSchema.parse(body);
    const result = await this.devices.activate(input.code, input.app_version);
    return {
      device_token: result.deviceToken,
      store_id: result.storeId,
      register_id: result.registerId,
      location_id: result.locationId,
    };
  }
}
```

```ts
// sync.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { DevicesService } from './devices.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service'; // added in Task 4; omit until then

@Module({ imports: [DbModule], controllers: [SyncController], providers: [DevicesService] })
export class SyncModule {}
```

  Match how other modules import DbModule (check `catalog.module.ts` for the exact pattern) and register SyncModule in `app.module.ts` if the stub isn't already imported.

- [ ] **Step 5: Run tests** → PASS (`pnpm --filter @retailos/api test -- devices`)
- [ ] **Step 6: Commit** — `feat(api): device activation exchange + bearer device auth (1B)`

---

### Task 4: GET /sync/bootstrap

**Files:**
- Create: `apps/api/src/modules/sync/sync.service.ts`
- Modify: `sync.controller.ts`, `sync.module.ts`
- Test: `apps/api/test/sync.service.test.ts` (new; grows in Tasks 5–6)

**Interfaces (produces):**
```ts
class SyncService {
  bootstrap(ctx: DeviceContext): Promise<BootstrapSnapshot>;
}
interface BootstrapSnapshot {
  rev: number;                     // stores.sync_seq at snapshot time (same tx)
  store: StoreDown;                // { id, name, currency, timezone, price_mode, settings }
  data: {
    roles: RoleDown[]; staff: StaffDown[];      // StaffDown = { id, name, role_id, pin_hash, active } — NO password/totp
    locations: LocationDown[]; registers: RegisterDown[];
    tax_categories: ...[]; tax_rates: ...[]; categories: ...[];
    products: ...[]; variants: ...[]; barcodes: ...[]; inventory_levels: ...[];
  };
}
```
Row shapes are snake_case JSON of the table columns minus `store_id`/`created_at`/`updated_at`, keeping `sync_rev`.

- [ ] **Step 1: Failing test** — seed a store with role/staff (with `pin_hash` AND `password_hash`), location, register, tax category+rate, category, product+variant+barcode, inventory level (reuse the seeding helpers pattern from `products.service.test.ts`). Assert:
  1. `bootstrap(ctx)` returns every seeded entity in `data`, `rev > 0`, and `rev >= max(sync_rev of returned rows)`.
  2. staff rows contain `pin_hash` but have **no** `password_hash`/`totp_secret` key.
  3. rows do not leak another store's data (seed a second store, assert absence).
- [ ] **Step 2: Run** → FAIL. 
- [ ] **Step 3: Implement.** One `forStore(ctx.storeId).tx` reading all tables with plain `tx.select()`, mapping to snake_case DTOs. Staff select lists explicit columns (`id, name, roleId, pinHash, active, syncRev`). `rev` = `SELECT sync_seq FROM stores WHERE id = ctx.storeId` in the same transaction (consistent snapshot: single tx = single MVCC snapshot).
- [ ] **Step 4: Controller route**

```ts
@Get('bootstrap')
@ApiOperation({ operationId: 'syncBootstrap', summary: 'Full snapshot for a freshly activated register (device token)' })
async bootstrap(@Req() req: Request) {
  const ctx = await this.devices.authenticate(req.headers.authorization);
  return this.sync.bootstrap(ctx);
}
```
- [ ] **Step 5: Run tests** → PASS. **Step 6: Commit** — `feat(api): sync bootstrap snapshot endpoint (1B)`

---

### Task 5: GET /sync/changes (delta feed + tombstones + pagination)

**Files:** modify `sync.service.ts`, `sync.controller.ts`, `dto.ts`; extend `apps/api/test/sync.service.test.ts`

**Interfaces (produces):**
```ts
interface ChangesPage {
  changes: { type: DownEntityType; rev: number; data: Record<string, unknown> }[]; // ascending rev
  next_since: number;   // last rev in page, or the request's `since` when empty
  has_more: boolean;
}
type DownEntityType = 'store'|'role'|'staff'|'location'|'register'|'tax_category'|'tax_rate'
  |'category'|'product'|'variant'|'barcode'|'inventory_level'|'tombstone';
changes(ctx: DeviceContext, since: number, limit = 500): Promise<ChangesPage>
```
Tombstone `data` = `{ entity_type, entity_id }`.

- [ ] **Step 1: Failing tests** (extend sync.service.test.ts):
  1. after bootstrap-level seeding, `changes(ctx, 0)` returns everything ascending by `rev`, `has_more false`.
  2. update one product; `changes(ctx, prevRev)` returns exactly that product row (and nothing else) with its new rev.
  3. delete the category; feed emits `{ type: 'tombstone', data: { entity_type: 'category', entity_id } }`.
  4. `changes(ctx, 0, 3)` → 3 changes, `has_more true`, and iterating pages with `next_since` reaches the same total set with no duplicates or gaps.
  5. staff change rows use the pin projection (no `password_hash`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In one tenant tx: for each source table `select ... where sync_rev > since order by sync_rev asc limit (limit + 1)`; map to `{type, rev, data}`; concat, sort by rev asc, slice `limit`; `has_more = merged.length > limit`. Stores source: `where id = storeId and sync_rev > since` (single row, mapped to type `'store'`). Query param validation in dto.ts: `z.coerce.number().int().min(0)` for `since`, limit capped at 500.
- [ ] **Step 4: Controller route** (device auth, same shape as bootstrap). Run tests → PASS.
- [ ] **Step 5: Commit** — `feat(api): sync delta feed with tombstones and keyset paging (1B)`

---

### Task 6: POST /sync/batches (fact ingest, idempotent replay, revalidation)

**Files:** modify `sync.service.ts`, `sync.controller.ts`, `dto.ts`; extend `apps/api/test/sync.service.test.ts`

**Interfaces (produces):**
```ts
// dto.ts (zod, snake_case per api-design.md representative payload)
const discountSchema = z.object({ type: z.enum(['percent','fixed']), value: z.number().int().min(0) });
const orderFactSchema = z.object({
  type: z.literal('order.completed'),
  order: z.object({
    id: ulidSchema, number: z.string().min(1), staff_id: ulidSchema.nullish(),
    customer_id: ulidSchema.nullish(), note: z.string().max(2000).nullish(),
    lines: z.array(z.object({
      id: ulidSchema, variant_id: ulidSchema.nullish(), name: z.string().min(1),
      qty: z.number().int().positive(), unit_price: z.object({ amount: z.number().int(), currency: z.string() }),
      discounts: z.array(discountSchema).default([]),
      tax_lines: z.array(z.object({ rate_id: z.string(), amount: z.number().int() })).default([]),
      total_amount: z.number().int(),
    })).min(1),
    totals: z.object({ subtotal: z.number().int(), discount: z.number().int(), tax: z.number().int(), total: z.number().int() }),
    tax_lines: z.array(z.object({ rate_id: z.string(), amount: z.number().int() })).default([]),
    payments: z.array(z.object({
      id: ulidSchema, tender: z.enum(['cash','card_manual']), amount: z.number().int(),
      change: z.number().int().default(0), card_ref: z.string().nullish(), card_last4: z.string().nullish(),
    })).min(1),
    client_created_at: z.string().datetime(), local_seq: z.number().int().positive(),
  }),
});
const movementFactSchema = z.object({
  type: z.literal('stock.movement'),
  movement: z.object({
    id: ulidSchema, variant_id: ulidSchema, location_id: ulidSchema,
    qty_delta: z.number().int(), movement_type: z.enum(['sale','refund_restock','adjustment']),
    ref_order_id: ulidSchema.nullish(), client_created_at: z.string().datetime().optional(),
  }),
});
export const syncBatchSchema = z.object({
  batch_id: ulidSchema,
  client: z.object({ register_id: ulidSchema, app_version: z.string().optional(), schema_rev: z.number().int().optional() }),
  facts: z.array(z.discriminatedUnion('type', [orderFactSchema, movementFactSchema])).min(1).max(500),
});

// sync.service.ts
interface FactAck { id: string; status: 'accepted' | 'duplicate' | 'accepted_with_conflict'; conflict?: { type: string } }
ingestBatch(ctx: DeviceContext, batch: SyncBatchInput): Promise<{ acks: FactAck[]; server_rev: number }>
```

- [ ] **Step 1: Failing tests** (the heart of 1B — write all of these):
  1. **Happy path**: batch with one `order.completed` (2 lines, cash payment, totals computed with `calculateCart` from `@retailos/domain` in the test so they match) + two `stock.movement` facts → all acks `accepted`; orders/order_lines/payments rows exist; `inventory_levels.on_hand` decremented; `stock_movements` rows exist with `ref_type='order'`.
  2. **Batch replay**: POST the identical batch again → identical acks (same statuses as first response, per stored `sync_batches.acks`); row counts unchanged.
  3. **Fact replay in a new batch** (new `batch_id`, same order fact) → ack `duplicate`; no new rows.
  4. **Total mismatch**: order fact with `totals.total` off by 10 → ack `accepted_with_conflict`, `sync_conflicts` row `conflict_type='total_mismatch'` with details containing both totals; order row still persisted **at the client's charged totals** (golden rule).
  5. **Unknown tax rate id** → ack `accepted_with_conflict`, conflict `stale_reference`.
  6. **Atomicity**: batch where the second fact violates an FK (movement for a nonexistent variant) → whole batch rejects (400/422 problem-json), first fact NOT persisted (transaction), and a retry after fixing succeeds with the same batch id.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `ingestBatch`** — single `forStore(ctx.storeId).tx`:

```
1. SELECT acks FROM sync_batches WHERE store_id, id = batch_id → if found, return stored acks + current server_rev (replay short-circuit).
2. Load store (currency, price_mode) + tax_rates into a Map(rate_id → rate_bp).
3. For each fact in order:
   order.completed:
     - SELECT 1 FROM orders WHERE id → 'duplicate'.
     - revalidate: build CartInput from lines (unitPriceAmount, qty, discounts,
       taxRates: [{ id: rate_id, name: id, rateBp }] for each line tax_line rate).
       Missing rate → conflict('stale_reference'), skip compare.
       Else compare calculateCart totals (subtotalAmount, discountAmount, taxAmount,
       totalAmount) to fact.totals → any diff → conflict('total_mismatch', details).
     - INSERT orders (state 'completed', currency = store.currency, number,
       register_id = ctx.registerId, location_id = ctx.locationId, staff/customer,
       client totals verbatim, tax_lines, client_created_at, local_seq)
       + order_lines + payments (captured_at = client_created_at).
     - ack accepted | accepted_with_conflict.
   stock.movement:
     - SELECT 1 FROM stock_movements WHERE id → 'duplicate'.
     - INSERT stock_movements (movement_type, qty_delta, ref_type = ref_order_id ? 'order' : null, ref_id).
     - UPSERT inventory_levels ON CONFLICT (store_id, variant_id, location_id)
       DO UPDATE SET on_hand = inventory_levels.on_hand + qty_delta (insert path: id = ulid(), on_hand = qty_delta).
4. INSERT sync_batches (id, register_id = ctx.registerId, device_id, fact_count, acks).
5. Return { acks, server_rev: stores.sync_seq }.
```

  Conflict helper inserts `sync_conflicts` with `id: ulid(), conflictType, entityType: 'order', entityId, details`. Order duplicates must be checked before revalidation so replays never double-log conflicts.
- [ ] **Step 4: Controller route** (`@Post('batches')`, device auth, `syncBatchSchema.parse`). Run tests → PASS. Run full API suite.
- [ ] **Step 5: Commit** — `feat(api): sync batch ingest — idempotent replay, domain revalidation, inventory projection (1B)`

---

### Task 7: OpenAPI regen

- [ ] **Step 1:** `pnpm --filter @retailos/api build && pnpm --filter @retailos/api generate:openapi`
- [ ] **Step 2:** `git diff apps/api/openapi/v1.yaml` — confirm the four `/sync/*` operations appear.
- [ ] **Step 3: Commit** — `chore(api): regenerate OpenAPI v1 with sync surface (1B)`

---

### Task 8: `@retailos/sync` — driver + device schema

**Files:**
- Create: `packages/sync/src/driver.ts`, `packages/sync/src/schema.ts`, `packages/sync/src/better-sqlite3-driver.ts`, `packages/sync/vitest.config.ts`, `packages/sync/test/schema.test.ts`
- Modify: `packages/sync/package.json` (scripts.test = `vitest run`; devDeps `better-sqlite3`, `@types/better-sqlite3`, `vitest`; peerDependencies `better-sqlite3` with `peerDependenciesMeta.better-sqlite3.optional = true`), `packages/sync/src/index.ts`

**Interfaces (produces):**
```ts
// driver.ts — synchronous by design: better-sqlite3 is sync, and sync txs are
// what make the outbox atomicity guarantee easy to reason about.
export interface SqlDriver {
  run(sql: string, params?: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  tx<T>(fn: () => T): T;           // BEGIN IMMEDIATE … COMMIT/ROLLBACK
  close(): void;
}
// better-sqlite3-driver.ts
export async function openBetterSqliteDriver(path: string): Promise<SqlDriver>; // lazy `await import('better-sqlite3')`
// schema.ts
export const DEVICE_SCHEMA_VERSION = 1;
export function migrateDeviceDb(driver: SqlDriver): void;  // idempotent
```

- [ ] **Step 1: Failing test** `packages/sync/test/schema.test.ts` — open `:memory:` driver, `migrateDeviceDb` twice (idempotent), assert `sqlite_master` contains all tables below and `sync_state` has its single row with `last_ack_rev = 0`.
- [ ] **Step 2: Run** `pnpm --filter @retailos/sync test` → FAIL.
- [ ] **Step 3: Implement.** `migrateDeviceDb` runs in one tx, guarded by `PRAGMA user_version`:

```sql
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_id TEXT, register_id TEXT, location_id TEXT, device_token TEXT,
  last_ack_rev INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL
);
INSERT OR IGNORE INTO sync_state (id, schema_version) VALUES (1, 1);
-- mirror (⬇): snake_case, JSON columns stored as TEXT, money INTEGER
CREATE TABLE IF NOT EXISTS store (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
  timezone TEXT NOT NULL, price_mode TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, permissions TEXT NOT NULL DEFAULT '{}', sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role_id TEXT NOT NULL,
  pin_hash TEXT, active INTEGER NOT NULL DEFAULT 1, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS registers (id TEXT PRIMARY KEY, location_id TEXT NOT NULL, name TEXT NOT NULL,
  grid_layout TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tax_categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tax_rates (id TEXT PRIMARY KEY, tax_category_id TEXT NOT NULL, name TEXT NOT NULL,
  rate_bp INTEGER NOT NULL, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, parent_id TEXT, name TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category_id TEXT,
  brand TEXT, images TEXT NOT NULL DEFAULT '[]', options TEXT NOT NULL DEFAULT '[]', tax_category_id TEXT NOT NULL,
  status TEXT NOT NULL, has_variants INTEGER NOT NULL DEFAULT 0, custom TEXT NOT NULL DEFAULT '{}', sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS variants (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, option_values TEXT NOT NULL DEFAULT '{}',
  sku TEXT, price_amount INTEGER NOT NULL, compare_at_amount INTEGER, cost_amount INTEGER,
  track_stock INTEGER NOT NULL DEFAULT 1, sync_rev INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS barcodes (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, code TEXT NOT NULL, sync_rev INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS barcodes_code_unique ON barcodes (code);
CREATE TABLE IF NOT EXISTS inventory_levels (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, location_id TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0, reorder_point INTEGER, reorder_qty INTEGER, sync_rev INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_levels_variant_location ON inventory_levels (variant_id, location_id);
-- facts (⬆, produced locally; POS-07/08 read these for 60 days)
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, number TEXT NOT NULL, staff_id TEXT, customer_id TEXT,
  state TEXT NOT NULL, currency TEXT NOT NULL, subtotal_amount INTEGER NOT NULL, discount_amount INTEGER NOT NULL,
  tax_amount INTEGER NOT NULL, total_amount INTEGER NOT NULL, tax_lines TEXT NOT NULL DEFAULT '[]', note TEXT,
  client_created_at TEXT NOT NULL, local_seq INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS orders_local_seq_unique ON orders (local_seq);
CREATE TABLE IF NOT EXISTS order_lines (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, variant_id TEXT, name TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_amount INTEGER NOT NULL, discounts TEXT NOT NULL DEFAULT '[]',
  tax_lines TEXT NOT NULL DEFAULT '[]', total_amount INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, tender_type TEXT NOT NULL,
  amount INTEGER NOT NULL, change_amount INTEGER NOT NULL DEFAULT 0, card_ref TEXT, card_last4 TEXT, captured_at TEXT);
CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY, variant_id TEXT NOT NULL, location_id TEXT NOT NULL,
  qty_delta INTEGER NOT NULL, movement_type TEXT NOT NULL, ref_order_id TEXT, client_created_at TEXT NOT NULL);
-- outbox: appended in the SAME tx as the fact rows (atomicity, strategy doc)
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL,
  batch_id TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), pushed_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (pushed_at) WHERE pushed_at IS NULL;
```

- [ ] **Step 4:** better-sqlite3 adapter (`tx` implemented with `db.transaction(fn).immediate()`), vitest config (node environment), package.json wiring. Run test → PASS.
- [ ] **Step 5: Commit** — `feat(sync): device SQLite schema + driver abstraction with better-sqlite3 adapter (1B)`

---

### Task 9: `@retailos/sync` — apply, bootstrap, pull

**Files:**
- Create: `packages/sync/src/http.ts`, `packages/sync/src/apply.ts`, `packages/sync/test/fake-server.ts`, `packages/sync/test/apply.test.ts`
- Modify: `packages/sync/src/index.ts`

**Interfaces (produces):**
```ts
// http.ts
export interface SyncHttpOptions { baseUrl: string; fetchImpl?: typeof fetch; getToken: () => string | undefined; }
export class SyncHttp {
  activate(code: string, appVersion?: string): Promise<{ device_token: string; store_id: string; register_id: string; location_id: string }>;
  bootstrap(): Promise<BootstrapSnapshot>;      // GET /sync/bootstrap
  changes(since: number, limit?: number): Promise<ChangesPage>;
  postBatch(body: SyncBatchBody): Promise<{ acks: FactAck[]; server_rev: number }>;
}
// apply.ts
export function applyBootstrap(driver: SqlDriver, snapshot: BootstrapSnapshot): void;  // clears mirror, inserts, sets last_ack_rev — one tx
export function applyChanges(driver: SqlDriver, page: ChangesPage): void;              // upserts/deletes + last_ack_rev — one tx
export function pullOnce(driver: SqlDriver, http: SyncHttp): Promise<{ pages: number; applied: number }>; // loops while has_more
```
Type strings map 1:1 to mirror table names (`'product'`→`products` etc.); `store` upserts the single `store` row; `tombstone` deletes by `entity_type`/`entity_id`. Unknown types are ignored (forward compatibility). JSON fields are `JSON.stringify`-ed into TEXT columns.

- [ ] **Step 1: fake-server.ts** — in-memory store: arrays per entity, monotonically increasing `rev`, `bootstrap()/changes(since, limit)/postBatch()` semantics matching Tasks 4–6 (including stored-acks batch replay and per-fact dedupe), `asFetch(): typeof fetch` exposing the four routes so `SyncHttp` is exercised for real. ~120 lines, no HTTP sockets.
- [ ] **Step 2: Failing tests** — seed fake server with a product/variant/barcode/tax rate/staff; `applyBootstrap` populates mirror + `last_ack_rev = rev`; server updates product + deletes category; `pullOnce` applies both (product row updated, category row gone); a second `pullOnce` is a no-op (0 applied); paging: 5 changes with `limit 2` → 3 pages, all applied once.
- [ ] **Step 3: Implement** http.ts (JSON fetch wrapper, throws `SyncHttpError(status, body)` on non-2xx), apply.ts (upsert = `INSERT … ON CONFLICT(id) DO UPDATE`). Run → PASS.
- [ ] **Step 4: Commit** — `feat(sync): bootstrap + delta pull applied atomically to the device mirror (1B)`

---

### Task 10: `@retailos/sync` — outbox + idempotent pusher

**Files:**
- Create: `packages/sync/src/outbox.ts`, `packages/sync/test/outbox.test.ts`
- Modify: `packages/sync/src/index.ts`

**Interfaces (produces):**
```ts
export interface LocalSaleInput { /* order fields exactly matching the order fact payload of Task 6, camelCase */ }
export function recordSale(driver: SqlDriver, sale: LocalSaleInput): void;
// writes orders + order_lines + payments + stock_movements rows AND their
// outbox entries (1 order.completed + N stock.movement) in ONE driver.tx
export function pendingCount(driver: SqlDriver): number;
export function claimBatch(driver: SqlDriver, max = 500): { batchId: string; facts: OutboxFact[] } | null;
// reuses an already-claimed batch_id if a previous push crashed pre-ack
export function markPushed(driver: SqlDriver, batchId: string, acks: FactAck[]): void;
export async function pushOnce(driver: SqlDriver, http: SyncHttp, registerId: string): Promise<{ pushed: number } | null>;
export async function pushWithRetry(driver: SqlDriver, http: SyncHttp, registerId: string,
  opts?: { retries?: number; baseDelayMs?: number; jitter?: () => number }): Promise<{ pushed: number }>;
```

- [ ] **Step 1: Failing tests**:
  1. **Atomicity**: make the outbox insert fail (temporarily rename the table inside the test via `DROP`… simpler: pass a sale whose second stock movement duplicates an id → PK violation) → `recordSale` throws AND no order/lines/payments/outbox rows exist (all-or-nothing).
  2. `recordSale` happy path → order queryable locally; `pendingCount() === 1 + movements`.
  3. `claimBatch` assigns one `batch_id` to ≤500 pending rows; calling it again before `markPushed` returns the **same** `batchId` and facts (crash-retry reuses the idempotency key).
  4. `pushOnce` against the fake server → facts persisted server-side, outbox rows get `pushed_at`, second `pushOnce` returns `null` (nothing pending).
  5. **Idempotent replay**: `claimBatch`, `postBatch` manually (simulating a push whose ack was lost), then `pushOnce` → fake server row counts unchanged (all-duplicate acks), outbox drained.
  6. `pushWithRetry` with a fetch that fails twice then succeeds (inject failing `fetchImpl`) → resolves, exactly one batch id ever seen by the server.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (ULIDs via a tiny local `ulid()` — add `ulid` dependency to packages/sync). Backoff: `delay = baseDelayMs * 2**attempt * (0.5 + jitter())`, default jitter `Math.random`, capped 30 s. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(sync): atomic outbox + pusher v1 with persisted batch idempotency keys (1B)`

---

### Task 11: `SyncClient` facade + full-lifecycle test

**Files:**
- Create: `packages/sync/src/client.ts`, `packages/sync/test/client.test.ts`
- Modify: `packages/sync/src/index.ts` (final export surface; delete the Phase-0 stub comment, keep `PACKAGE_NAME`)

**Interfaces (produces):**
```ts
export interface SecretStore { get(key: string): string | undefined; set(key: string, value: string): void; }
export class SqliteSecretStore implements SecretStore { constructor(driver: SqlDriver) {} } // sync_state.device_token; keychain adapter lands in 1C
export interface SyncStatus { state: 'never_bootstrapped' | 'idle' | 'pending'; pendingFacts: number; lastAckRev: number; }
export class SyncClient {
  constructor(opts: { driver: SqlDriver; baseUrl: string; fetchImpl?: typeof fetch; secrets?: SecretStore });
  activate(code: string, appVersion?: string): Promise<void>;   // stores token + ids in sync_state
  bootstrap(): Promise<void>;
  sync(): Promise<{ pushed: number; pulled: number }>;          // push first (facts up), then pull
  recordSale(sale: LocalSaleInput): void;
  status(): SyncStatus;
}
```

- [ ] **Step 1: Failing lifecycle test** against the fake server: `activate('CODE1234')` → `bootstrap()` → mirror populated → `recordSale(...)` while "offline" (fetch throws) → `status().pendingFacts > 0`, sale readable locally → restore network → `sync()` → server has the order exactly once, `status()` = idle → server price change → `sync()` pulls it. Then the marquee assertion: run `sync()` twice more → server order count still 1.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (thin composition of Tasks 8–10). **Step 4: Run** → PASS; run `pnpm turbo typecheck lint test --filter @retailos/sync`.
- [ ] **Step 5: Commit** — `feat(sync): SyncClient facade — activate/bootstrap/sync lifecycle (1B)`

---

### Task 12: End-to-end verification + close out

- [ ] **Step 1:** Invoke the repo `verify` skill: boot Postgres + API locally, then drive the real stack with a scratch script (`scratchpad/sync-e2e.mjs`) that imports `@retailos/sync` dist: admin signup → create product + register + activation code via API → `SyncClient.activate(code)` → `bootstrap` → `recordSale` → `sync()` → assert order visible via admin `GET /orders`… (if the admin orders list endpoint doesn't exist yet — it's 1C — assert directly via `psql` row counts instead). Re-run the batch push → row count unchanged.
- [ ] **Step 2:** `pnpm turbo typecheck lint test` at repo root → all green (show output).
- [ ] **Step 3:** Update `05-roadmap/phase-1-core-pos-mvp.md`: mark §1B `— ✅ complete <date>` with a shipped-summary line (mirror the 1A format, list what shipped + test counts).
- [ ] **Step 4: Commit** — `docs(roadmap): 1B POS data layer complete (1B)`

## Self-review notes

- Spec coverage: SQLite schema ✅ (Task 8), bootstrap ✅ (4, 9), delta pull ✅ (5, 9), outbox+pusher+idempotent replay ✅ (6, 10, 11), device activation (prerequisite for device-token'd endpoints, api-design.md §Auth) ✅ (3), non-deferrable atomic outbox ✅ (10 test 1), docs-first rule ✅ (Task 1, OpenAPI Task 7).
- Deliberately out: conflict matrix beyond `total_mismatch`/`stale_reference` (Phase 3), webhooks emission (module still stub — noted in Task 1 doc edit), Electron keychain + IndexedDB browser queue (1C), customers sync (Phase 2).
- Type consistency: `DeviceContext` produced in Task 3 is consumed by Tasks 4–6; `BootstrapSnapshot`/`ChangesPage`/`FactAck` shapes shared between server (4–6) and client http/apply (9–10); fact payload zod (Task 6) matches `recordSale` outbox payloads (Task 10) and api-design.md's representative payload.
