# 1E Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn signup into the approved ADM-01 flow — a 3-step wizard plus a first-sale checklist over an empty-state dashboard — so a fresh store reaches its first sale in under 15 minutes (FR-10.1).

**Architecture:** Extend the existing atomic `/auth/signup` to also provision a Main location + Register 1 + activation code (plaintext echoed to `stores.settings.onboarding`). A new `SampleDataService` seeds/purges a Singapore SGD sample catalog tagged with a `sample_batch_id` (migration 0007). A derived `GET /onboarding/status` drives the admin wizard and Home checklist. No new sync facts — the sample catalog reaches devices through the existing bootstrap/changes feed.

**Tech Stack:** NestJS + Drizzle + Postgres (api), PGlite (api tests), Next.js App Router + react-query + `@retailos/ui` (admin), Vitest.

## Global Constraints

- Money is integers in minor units (centavos/cents); never floats. (`CLAUDE.md`)
- Multi-tenant: every business table carries `store_id`; access via `db.tenants.forStore(storeId).tx(...)` or `dangerouslyCrossTenant(...)` only where the tenant does not yet exist. (`CLAUDE.md`)
- TypeScript strict; no `any` without a `// why:` comment. (`CLAUDE.md`)
- Sample dataset is the **Singapore SGD** convenience-store set (~40 products); the ADM-01 mockup's Filipino copy is illustrative only. (spec Decision 1)
- Sample rows carry a nullable `sample_batch_id`; purge nulls `order_lines.variant_id` on referencing lines. (spec Decision 2)
- Empty-state dashboard only; real analytics are ADM-02, out of scope. (spec Decision 3)
- No address capture. (spec Decision 4)
- Migration files run once in name order, tracked in `_migrations`; next number is `0007`.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- pnpm is at `~/.local/bin` (`export PATH="$HOME/.local/bin:$PATH"`); Postgres dev is `postgres://retailos:retailos@localhost:5433/retailos` (colima).

---

## File Structure

- `apps/api/src/db/migrations/0007_sample_data.sql` — new columns + indexes.
- `apps/api/src/db/schema.ts` — add `sampleBatchId` to products/variants/categories/inventoryLevels.
- `apps/api/src/modules/identity/dto.ts` — `name` on signup schema.
- `apps/api/src/modules/identity/identity.service.ts` — provision location/register/code + echo; `name`.
- `apps/api/src/modules/settings/store.service.ts` (new) + `store.controller.ts` (new) — `PATCH /settings/store`.
- `apps/api/src/modules/onboarding/` (new module) — `sample-catalog.sg.ts` data, `sample-data.service.ts`, `onboarding.service.ts` (status), `onboarding.controller.ts`, `onboarding.module.ts`.
- `apps/admin/src/lib/onboarding-api.ts` (new) — typed client for status/sample/store-profile.
- `apps/admin/src/app/signup/page.tsx` — 3-step wizard.
- `apps/admin/src/app/dashboard/page.tsx` — checklist + empty-state dashboard.
- `.superpowers/sdd/1e-e2e.mjs` (gitignored) — live E2E.

---

## Task 1: Migration 0007 + schema columns

**Files:**
- Create: `apps/api/src/db/migrations/0007_sample_data.sql`
- Modify: `apps/api/src/db/schema.ts` (products, variants, categories, inventoryLevels)
- Test: `apps/api/test/sample-data-migration.test.ts`

**Interfaces:**
- Produces: `products.sample_batch_id`, `variants.sample_batch_id`, `categories.sample_batch_id`, `inventory_levels.sample_batch_id` (all `text`, nullable); Drizzle columns `sampleBatchId`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/sample-data-migration.test.ts
import { describe, expect, it } from 'vitest';
import { withTestDb } from './helpers/test-db';

describe('0007_sample_data', () => {
  it('adds nullable sample_batch_id to the catalog tables', async () => {
    await withTestDb(async (db) => {
      for (const table of ['products', 'variants', 'categories', 'inventory_levels']) {
        const rows = await db.query(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'sample_batch_id'`,
          [table],
        );
        expect(rows.rows[0]?.is_nullable).toBe('YES');
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/sample-data-migration.test.ts`
Expected: FAIL — column does not exist. (Confirm `withTestDb`/helper name by mirroring an existing api test such as `apps/api/test/shift-ingest.service.test.ts`; adapt the query call to the harness's client API.)

- [ ] **Step 3: Write the migration**

```sql
-- 0007_sample_data — sample catalog tagging (1E, FR-10.1). Seeded onboarding
-- products carry a sample_batch_id so a one-click purge removes exactly that
-- batch and nothing the owner created. Nullable everywhere so real catalog rows
-- are unaffected. Partial indexes keep purge cheap.
ALTER TABLE products ADD COLUMN sample_batch_id text;
ALTER TABLE variants ADD COLUMN sample_batch_id text;
ALTER TABLE categories ADD COLUMN sample_batch_id text;
ALTER TABLE inventory_levels ADD COLUMN sample_batch_id text;

CREATE INDEX products_sample_batch_idx ON products (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX variants_sample_batch_idx ON variants (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX categories_sample_batch_idx ON categories (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
CREATE INDEX inventory_levels_sample_batch_idx ON inventory_levels (store_id, sample_batch_id) WHERE sample_batch_id IS NOT NULL;
```

(Verify each table already has a `store_id` column — mirror the index shape used in prior migrations; drop `store_id` from an index if a table lacks it.)

- [ ] **Step 4: Add the Drizzle columns**

In `apps/api/src/db/schema.ts`, add to each of the `products`, `variants`, `categories`, `inventoryLevels` pgTable definitions:

```ts
  sampleBatchId: text('sample_batch_id'),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run test/sample-data-migration.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/0007_sample_data.sql apps/api/src/db/schema.ts apps/api/test/sample-data-migration.test.ts
git commit -m "$(printf 'feat(api): migration 0007 sample_batch_id on catalog tables (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 2: Signup expansion + store-profile PATCH

**Files:**
- Modify: `apps/api/src/modules/identity/dto.ts` (signupSchema `name`)
- Modify: `apps/api/src/modules/identity/identity.service.ts` (`SignupInput.name`; provision loop; echo)
- Modify: `apps/api/src/modules/identity/identity.controller.ts` (pass `name`)
- Create: `apps/api/src/modules/settings/store.service.ts`, `apps/api/src/modules/settings/store.controller.ts`
- Modify: `apps/api/src/modules/settings/settings.module.ts` (register the store controller/service)
- Modify: `apps/api/src/modules/settings/dto.ts` (`updateStoreSchema`)
- Test: `apps/api/test/signup-onboarding.service.test.ts`

**Interfaces:**
- Consumes: `stores`, `roles`, `staff`, `taxCategories`, `taxRates`, `locations`, `registers`, `activationCodes` schema; `hashActivationCode`, Crockford code gen (mirror `registers.service.ts` lines 87–111).
- Produces: signup persists a Main location, a `Register 1`, an activation code, and `stores.settings.onboarding = { activation_code, activation_expires_at, register_id }`. `PATCH /settings/store` updates `{ name?, currency?, timezone?, price_mode? }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/signup-onboarding.service.test.ts
import { describe, expect, it } from 'vitest';
import { makeIdentityService } from './helpers/make-services'; // mirror existing api service tests
import { withTestDb } from './helpers/test-db';

describe('signup onboarding provisioning', () => {
  it('creates a location, register, and echoes an activation code', async () => {
    await withTestDb(async (db) => {
      const identity = makeIdentityService(db);
      const who = await identity.signup({
        email: 'owner@example.com', password: 'longenough12', name: 'Bea Santos',
        storeName: 'Demo Mart', currency: 'SGD',
      });
      const locs = await db.query(`SELECT name FROM locations WHERE store_id=$1`, [who.storeId]);
      const regs = await db.query(`SELECT name FROM registers WHERE store_id=$1`, [who.storeId]);
      const store = await db.query(`SELECT settings FROM stores WHERE id=$1`, [who.storeId]);
      expect(locs.rows[0]?.name).toBe('Main');
      expect(regs.rows[0]?.name).toBe('Register 1');
      const onboarding = store.rows[0]?.settings?.onboarding;
      expect(typeof onboarding?.activation_code).toBe('string');
      expect(onboarding.activation_code.length).toBeGreaterThan(0);
    });
  });
});
```

(Match the actual service-construction/`withTestDb` helpers used by `apps/api/test/shift-ingest.service.test.ts`; adjust `makeIdentityService` to however that file instantiates services.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/signup-onboarding.service.test.ts`
Expected: FAIL — no `name` param / no location created.

- [ ] **Step 3: Add `name` to the signup schema**

In `apps/api/src/modules/identity/dto.ts`, extend `signupSchema`:

```ts
export const signupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(128),
  name: z.string().min(1).max(120),
  store_name: z.string().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. SGD'),
});
```

- [ ] **Step 4: Provision the register loop in `identity.service.ts`**

Add `name: string;` to `SignupInput`. Inside the `dangerouslyCrossTenant` transaction, after the tax rate insert and before `return`, add (import `locations`, `registers`, `activationCodes` from schema; add the Crockford helpers mirroring `registers.service.ts`):

```ts
    // 1E: provision the register loop so the onboarding checklist has a real
    // activation code the moment signup returns.
    const locationId = ulid();
    await tx.insert(locations).values({ id: locationId, storeId, name: 'Main' });
    const registerId = ulid();
    await tx.insert(registers).values({
      id: registerId, storeId, locationId, name: 'Register 1', gridLayout: {},
    });
    const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const code = Array.from({ length: 8 }, () => CROCKFORD[randomInt(CROCKFORD.length)]).join('');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.insert(activationCodes).values({
      id: ulid(), storeId, registerId,
      codeHash: createHash('sha256').update(code).digest('hex'),
      expiresAt, createdBy: staffId,
    });
    await tx.update(stores).set({
      settings: {
        onboarding: {
          activation_code: code,
          activation_expires_at: expiresAt.toISOString(),
          register_id: registerId,
        },
      },
    }).where(eq(stores.id, storeId));
```

Add imports at top: `import { createHash, randomInt } from 'node:crypto';` and extend the schema import to include `activationCodes, locations, registers`. Use `input.name` for `staff.name` (fall back to the email local-part when empty).

- [ ] **Step 5: Pass `name` from the controller**

In `identity.controller.ts` `signup()`, add `name: input.name` to the `this.identity.signup({...})` call.

- [ ] **Step 6: Add the store-profile PATCH**

`apps/api/src/modules/settings/dto.ts`:

```ts
export const updateStoreSchema = z
  .object({
    name: z.string().min(1).max(120),
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1).max(64),
    price_mode: z.enum(['tax_inclusive', 'tax_exclusive']),
  })
  .partial();
export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;
```

`apps/api/src/modules/settings/store.service.ts` (mirror `locations.service.ts` structure):

```ts
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { stores } from '../../db/schema';
import type { UpdateStoreInput } from './dto';

@Injectable()
export class StoreService {
  constructor(private readonly db: DbService) {}

  async update(storeId: string, input: UpdateStoreInput) {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (input.price_mode !== undefined) patch.priceMode = input.price_mode;
      const rows = await tx.update(stores).set(patch).where(eq(stores.id, storeId))
        .returning({ id: stores.id, name: stores.name, currency: stores.currency,
          timezone: stores.timezone, priceMode: stores.priceMode });
      const s = rows[0]!;
      return { id: s.id, name: s.name, currency: s.currency, timezone: s.timezone, price_mode: s.priceMode };
    });
  }
}
```

`apps/api/src/modules/settings/store.controller.ts`:

```ts
import { Body, Controller, Patch, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { requireSession } from '../../common/session';
import { updateStoreSchema } from './dto';
import { StoreService } from './store.service';

@ApiTags('settings')
@Controller('settings/store')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Patch()
  @ApiOperation({ operationId: 'updateStore', summary: 'Update store profile (name/currency/timezone/tax mode)' })
  async update(@Body() body: unknown, @Req() req: Request) {
    const { storeId } = requireSession(req);
    return this.store.update(storeId, updateStoreSchema.parse(body));
  }
}
```

Register both in `settings.module.ts` (`controllers` + `providers`).

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/api && pnpm vitest run test/signup-onboarding.service.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/identity apps/api/src/modules/settings apps/api/test/signup-onboarding.service.test.ts
git commit -m "$(printf 'feat(api): signup provisions register loop + store-profile PATCH (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 3: Sample catalog dataset + seed/purge

**Files:**
- Create: `apps/api/src/modules/onboarding/sample-catalog.sg.ts`
- Create: `apps/api/src/modules/onboarding/sample-data.service.ts`
- Create: `apps/api/src/modules/onboarding/onboarding.module.ts`
- Test: `apps/api/test/sample-data.service.test.ts`

**Interfaces:**
- Consumes: `products, variants, barcodes, categories, inventoryLevels, orderLines, registers, stores` schema; the store's "Standard" tax category (seeded at signup) and its first location.
- Produces: `SampleDataService.seed(storeId): Promise<{ batchId: string; productCount: number }>`, `SampleDataService.purge(storeId): Promise<{ removed: number }>`. Dataset export `SAMPLE_CATALOG_SG: { categories: {...}[]; products: {...}[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/sample-data.service.test.ts
import { describe, expect, it } from 'vitest';
import { makeIdentityService, makeSampleDataService } from './helpers/make-services';
import { withTestDb } from './helpers/test-db';

describe('SampleDataService', () => {
  it('seeds the SGD batch then purges it, preserving a practice order line', async () => {
    await withTestDb(async (db) => {
      const identity = makeIdentityService(db);
      const who = await identity.signup({ email: 'o@x.co', password: 'longenough12',
        name: 'O', storeName: 'M', currency: 'SGD' });
      const sample = makeSampleDataService(db);
      const seeded = await sample.seed(who.storeId);
      expect(seeded.productCount).toBeGreaterThanOrEqual(40);
      const tagged = await db.query(
        `SELECT count(*) FROM products WHERE store_id=$1 AND sample_batch_id=$2`,
        [who.storeId, seeded.batchId]);
      expect(Number(tagged.rows[0].count)).toBe(seeded.productCount);

      // simulate a practice sale against a sample variant
      const v = await db.query(`SELECT id FROM variants WHERE store_id=$1 AND sample_batch_id=$2 LIMIT 1`,
        [who.storeId, seeded.batchId]);
      const variantId = v.rows[0].id;
      await db.query(`INSERT INTO orders (id, store_id, number, status, subtotal_amount, tax_amount, total_amount)
        VALUES ('ORD1', $1, 'R1-0001', 'completed', 100, 9, 109)`, [who.storeId]);
      await db.query(`INSERT INTO order_lines (id, store_id, order_id, variant_id, name, qty, unit_price_amount)
        VALUES ('OL1', $1, 'ORD1', $2, 'Sample', 1, 100)`, [who.storeId, variantId]);

      await sample.purge(who.storeId);
      const left = await db.query(`SELECT count(*) FROM products WHERE store_id=$1 AND sample_batch_id IS NOT NULL`,
        [who.storeId]);
      expect(Number(left.rows[0].count)).toBe(0);
      const line = await db.query(`SELECT variant_id, name FROM order_lines WHERE id='OL1'`);
      expect(line.rows[0].variant_id).toBeNull();      // FK nulled
      expect(line.rows[0].name).toBe('Sample');        // history preserved
    });
  });
});
```

(Adapt column names in the raw `orders`/`order_lines` inserts to the real schema — check `apps/api/src/db/schema.ts` for required NOT NULL columns and add them.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/sample-data.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the dataset**

`apps/api/src/modules/onboarding/sample-catalog.sg.ts` — export ~40 Singapore convenience-store products. Shape:

```ts
export interface SampleProduct {
  name: string; category: string; barcode: string;
  price: number;   // SGD cents, integer
  stock: number;
}
export interface SampleCatalog {
  categories: string[];
  products: SampleProduct[];
}

// why: fixed demo dataset; prices are integer minor units (SGD cents).
export const SAMPLE_CATALOG_SG: SampleCatalog = {
  categories: ['Drinks', 'Snacks', 'Instant Food', 'Household', 'Personal Care'],
  products: [
    { name: 'Kopi-O (canned)', category: 'Drinks', barcode: '8888000000011', price: 180, stock: 48 },
    { name: 'Teh Tarik (canned)', category: 'Drinks', barcode: '8888000000028', price: 190, stock: 48 },
    { name: 'Milo (can)', category: 'Drinks', barcode: '8888000000035', price: 210, stock: 36 },
    { name: '100PLUS (can)', category: 'Drinks', barcode: '8888000000042', price: 170, stock: 60 },
    { name: 'Yeo\'s Chrysanthemum Tea', category: 'Drinks', barcode: '8888000000059', price: 160, stock: 60 },
    { name: 'Bottled Water 500ml', category: 'Drinks', barcode: '8888000000066', price: 90, stock: 96 },
    { name: 'Coca-Cola 320ml', category: 'Drinks', barcode: '8888000000073', price: 150, stock: 72 },
    { name: 'Pokka Green Tea', category: 'Drinks', barcode: '8888000000080', price: 175, stock: 48 },
    { name: 'Maggi Curry Cup', category: 'Instant Food', barcode: '8888000000103', price: 220, stock: 40 },
    { name: 'Maggi Chicken 5-pack', category: 'Instant Food', barcode: '8888000000110', price: 340, stock: 30 },
    { name: 'Koka Laksa Noodles', category: 'Instant Food', barcode: '8888000000127', price: 250, stock: 30 },
    { name: 'Cup Rice Chicken', category: 'Instant Food', barcode: '8888000000134', price: 380, stock: 24 },
    { name: 'Canned Sardines', category: 'Instant Food', barcode: '8888000000141', price: 200, stock: 36 },
    { name: 'Baked Beans', category: 'Instant Food', barcode: '8888000000158', price: 230, stock: 36 },
    { name: 'Kaya Jam', category: 'Instant Food', barcode: '8888000000165', price: 420, stock: 24 },
    { name: 'Gardenia White Bread', category: 'Instant Food', barcode: '8888000000172', price: 300, stock: 20 },
    { name: 'Potato Chips (Original)', category: 'Snacks', barcode: '8888000000202', price: 320, stock: 40 },
    { name: 'Prawn Crackers', category: 'Snacks', barcode: '8888000000219', price: 190, stock: 48 },
    { name: 'Chocolate Wafer', category: 'Snacks', barcode: '8888000000226', price: 130, stock: 60 },
    { name: 'Mentos Roll', category: 'Snacks', barcode: '8888000000233', price: 120, stock: 72 },
    { name: 'Kit Kat 4-finger', category: 'Snacks', barcode: '8888000000240', price: 180, stock: 60 },
    { name: 'Biscuits (Cream)', category: 'Snacks', barcode: '8888000000257', price: 150, stock: 48 },
    { name: 'Peanuts (packet)', category: 'Snacks', barcode: '8888000000264', price: 140, stock: 48 },
    { name: 'Seaweed Snack', category: 'Snacks', barcode: '8888000000271', price: 200, stock: 36 },
    { name: 'Dried Mango', category: 'Snacks', barcode: '8888000000288', price: 260, stock: 30 },
    { name: 'Gummy Bears', category: 'Snacks', barcode: '8888000000295', price: 170, stock: 48 },
    { name: 'Tissue Box', category: 'Household', barcode: '8888000000301', price: 250, stock: 30 },
    { name: 'Toilet Roll 4-pack', category: 'Household', barcode: '8888000000318', price: 380, stock: 24 },
    { name: 'Dish Soap', category: 'Household', barcode: '8888000000325', price: 320, stock: 24 },
    { name: 'Laundry Powder 1kg', category: 'Household', barcode: '8888000000332', price: 560, stock: 18 },
    { name: 'Garbage Bags (roll)', category: 'Household', barcode: '8888000000349', price: 290, stock: 24 },
    { name: 'AA Batteries 4-pack', category: 'Household', barcode: '8888000000356', price: 480, stock: 20 },
    { name: 'Lighter', category: 'Household', barcode: '8888000000363', price: 100, stock: 60 },
    { name: 'Toothpaste', category: 'Personal Care', barcode: '8888000000400', price: 340, stock: 24 },
    { name: 'Toothbrush', category: 'Personal Care', barcode: '8888000000417', price: 220, stock: 36 },
    { name: 'Bar Soap', category: 'Personal Care', barcode: '8888000000424', price: 160, stock: 48 },
    { name: 'Shampoo Sachet', category: 'Personal Care', barcode: '8888000000431', price: 60, stock: 96 },
    { name: 'Hand Sanitiser 50ml', category: 'Personal Care', barcode: '8888000000448', price: 280, stock: 30 },
    { name: 'Face Mask 5-pack', category: 'Personal Care', barcode: '8888000000455', price: 300, stock: 30 },
    { name: 'Plaster Strips', category: 'Personal Care', barcode: '8888000000462', price: 240, stock: 30 },
    { name: 'Panadol (blister)', category: 'Personal Care', barcode: '8888000000479', price: 350, stock: 24 },
  ],
};
```

- [ ] **Step 4: Write `SampleDataService`**

`apps/api/src/modules/onboarding/sample-data.service.ts` — seed inserts categories→products→variants→barcodes→inventory levels stamped with one `batchId`, records it in `stores.settings.onboarding.sample_batch_id`, and sets `Register 1`'s `grid_layout`. purge nulls `order_lines.variant_id` for batch variants, deletes the batch rows in FK-safe order (inventory→barcodes→variants→products→categories), and clears the settings key. Mirror insert patterns from `product-import.service.ts`. Use `db.tenants.forStore(storeId).tx(...)`. Guard `seed` to refuse when `settings.onboarding.sample_batch_id` already set. Read the store's first location for inventory levels and the "Standard" tax category id for products.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/api && pnpm vitest run test/sample-data.service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/onboarding apps/api/test/sample-data.service.test.ts
git commit -m "$(printf 'feat(api): Singapore SGD sample catalog seed + purge (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 4: Onboarding status endpoint

**Files:**
- Create: `apps/api/src/modules/onboarding/onboarding.service.ts`
- Create: `apps/api/src/modules/onboarding/onboarding.controller.ts`
- Modify: `apps/api/src/modules/onboarding/onboarding.module.ts` (wire status + sample endpoints)
- Modify: `apps/api/src/app.module.ts` (import OnboardingModule)
- Test: `apps/api/test/onboarding.service.test.ts`

**Interfaces:**
- Consumes: `stores` (settings), `products`, `devices`, `orders` counts; `SampleDataService`.
- Produces: `GET /onboarding/status` → `{ steps: { account, store_profile, catalog, register, first_sale: boolean }, blocked: { first_sale?: string }, activation_code?: string, activation_expires_at?: string, currency, store_name, minutes_remaining, dismissed }`. `POST /onboarding/sample-catalog`, `DELETE /onboarding/sample-catalog`, `POST /onboarding/dismiss`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/onboarding.service.test.ts
import { describe, expect, it } from 'vitest';
import { makeIdentityService, makeOnboardingService } from './helpers/make-services';
import { withTestDb } from './helpers/test-db';

describe('OnboardingService.status', () => {
  it('reflects account+store+register done, catalog+first_sale not', async () => {
    await withTestDb(async (db) => {
      const who = await makeIdentityService(db).signup({ email: 'o@x.co',
        password: 'longenough12', name: 'O', storeName: 'M', currency: 'SGD' });
      const status = await makeOnboardingService(db).status(who.storeId);
      expect(status.steps.account).toBe(true);
      expect(status.steps.store_profile).toBe(true);
      expect(status.steps.register).toBe(false);   // no device activated yet
      expect(status.steps.catalog).toBe(false);
      expect(status.steps.first_sale).toBe(false);
      expect(status.blocked.first_sale).toBeTruthy();
      expect(typeof status.activation_code).toBe('string');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/onboarding.service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `OnboardingService.status`**

Derive booleans from counts: `account` = true; `store_profile` = store row exists; `catalog` = `count(products) > 0`; `register` = a `devices` row exists for the store (activated); `first_sale` = `count(orders) > 0`. `blocked.first_sale` = `'Waiting for a register'` when `!register`. Pull `activation_code`/`activation_expires_at` from `stores.settings.onboarding` only while `register` is false (clear/omit once activated). `minutes_remaining` = `notDoneCount * 3` (matches the mockup's rough countdown). `dismissed` from `settings.onboarding.checklist_dismissed`.

- [ ] **Step 4: Write the controller + module**

`onboarding.controller.ts` — `GET /onboarding/status`, `POST /onboarding/sample-catalog` (→ `sampleData.seed`), `DELETE /onboarding/sample-catalog` (→ `sampleData.purge`), `POST /onboarding/dismiss` (set `settings.onboarding.checklist_dismissed = true`). All `requireSession`-gated. Wire `OnboardingModule` (providers: `OnboardingService`, `SampleDataService`; controllers: `OnboardingController`) and import it in `app.module.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && pnpm vitest run test/onboarding.service.test.ts`
Expected: PASS

- [ ] **Step 6: Regenerate OpenAPI + commit**

Run the repo's OpenAPI regen (mirror how prior api tasks did it, e.g. `pnpm --filter @retailos/api openapi` if present; otherwise skip).

```bash
git add apps/api/src/modules/onboarding apps/api/src/app.module.ts apps/api/test/onboarding.service.test.ts
git commit -m "$(printf 'feat(api): GET /onboarding/status + sample-catalog endpoints (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 5: Admin 3-step wizard

**Files:**
- Create: `apps/admin/src/lib/onboarding-api.ts`
- Modify: `apps/admin/src/app/signup/page.tsx` (single-card → 3 steps)
- Test: browser walkthrough (verification workflow); no unit test framework in admin for pages.

**Interfaces:**
- Consumes: `POST /api/v1/auth/signup` (now with `name`), `PATCH /api/v1/settings/store`, `POST /api/v1/onboarding/sample-catalog`.
- Produces: `onboardingApi.getStatus()`, `onboardingApi.updateStore(patch)`, `onboardingApi.seedSample()`, `onboardingApi.purgeSample()`, `onboardingApi.dismiss()` typed against the resources above.

- [ ] **Step 1: Write `onboarding-api.ts`** mirroring `apps/admin/src/lib/catalog-api.ts` (same `api` client import, resource interfaces `OnboardingStatus`, functions listed above).

- [ ] **Step 2: Build the wizard** in `signup/page.tsx` — local `step` state (1|2|3):
  - **Step 1 Account**: name, email, password (min 10; hint shows live remaining count); on submit `POST /auth/signup` with a provisional `store_name` (reuse the name field or a default) → advance. Duplicate-email `ApiError` → inline "This email already has a store — sign in instead?" linking `/login`; short password → rule + count; primary button `disabled` in place with the 2px danger border pattern from the product editor.
  - **Step 2 Store profile**: store name, currency (prefill from `Intl` locale), timezone (prefill from `Intl.DateTimeFormat().resolvedOptions().timeZone`), a segmented **Prices include VAT / Add VAT at the till** control → `price_mode`; on Continue `PATCH /settings/store`.
  - **Step 3 Starting catalog**: two choice cards (sample preselected w/ mini chips; empty w/ CSV hint); Finish → if sample chosen `POST /onboarding/sample-catalog`, then `router.push('/dashboard')`.
  - Use the bare centered stage + step dots + wordmark from the mockup; reuse `@retailos/ui` `Button`, `Input`, `Card`.

- [ ] **Step 3: Verify in the browser** (see Task 7 verification). Ensure both catalog paths land on Home.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/onboarding-api.ts apps/admin/src/app/signup/page.tsx
git commit -m "$(printf 'feat(admin): ADM-01 3-step onboarding wizard (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 6: Home first-sale checklist + empty-state dashboard

**Files:**
- Modify: `apps/admin/src/app/dashboard/page.tsx`
- Test: browser walkthrough.

**Interfaces:**
- Consumes: `onboardingApi.getStatus()` (polled), `onboardingApi.dismiss()`.

- [ ] **Step 1: Adopt AppShell** (mirror `apps/admin/src/app/shifts/page.tsx`, `title="Home"`).

- [ ] **Step 2: Checklist card** — `useQuery(['onboarding-status'], onboardingApi.getStatus, { refetchInterval: 5000 })`. Headline: `First sale in about {minutes_remaining} more minutes · {doneCount} of 5 done`; progress bar `doneCount/5`. Rows for the 5 steps: done → collapsed one-liner with a filled check; **Connect a register** (when not done) shows `activation_code` inline (mono) + expiry + "Show full instructions"; **Ring up your first sale** disabled with `blocked.first_sale` reason until `register` is true. "I've done this before — hide" → `onboardingApi.dismiss()` then hide (respect `dismissed` from status on load).

- [ ] **Step 3: Empty-state dashboard** beneath — three em-dash StatCards (Revenue today `₱ —` using store currency symbol, Transactions `—`, Average basket) and an empty chart block with "Your first sale lights this up / Sales by hour and top items appear once a register rings one up."

- [ ] **Step 4: Verify in the browser** (Task 7). Confirm the checklist flips `register`/`first_sale` after a device activates + rings a sale.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app/dashboard/page.tsx
git commit -m "$(printf 'feat(admin): first-sale checklist + empty-state dashboard (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Task 7: E2E + full-repo gate + docs close-out

**Files:**
- Create: `.superpowers/sdd/1e-e2e.mjs` (gitignored)
- Create: `.superpowers/sdd/1e-report.md` (gitignored)
- Modify: `05-roadmap/phase-1-core-pos-mvp.md` (mark 1E complete; tick acceptance line "Signup-to-first-sale timed run < 15 min")

- [ ] **Step 1: Write the live E2E** (mirror `.superpowers/sdd/1d-e2e.mjs`): psql-seed nothing — instead drive the real API: `POST /auth/signup` (with `name`, currency SGD) → assert `stores.settings.onboarding.activation_code` present, a Main location + Register 1 exist → `GET /onboarding/status` (account/store true, register/catalog/first_sale false) → `POST /onboarding/sample-catalog` → assert ≥40 tagged products, status `catalog` true → read the echoed code, `POST /sync/activate` with it → status `register` true, code no longer echoed → push an `order.completed` batch → status `first_sale` true → `DELETE /onboarding/sample-catalog` → assert 0 sample products remain and any `order_lines.variant_id` for the sold sample variant is null while the line name survives.

- [ ] **Step 2: Run the E2E** against the running API + Postgres.

Run: `node .superpowers/sdd/1e-e2e.mjs`
Expected: all assertions PASS.

- [ ] **Step 3: Full-repo gate**

Run: `pnpm turbo typecheck lint test`
Expected: all tasks pass.

- [ ] **Step 4: Browser verification** — full wizard walkthrough (both catalog choices), Home checklist reflecting an activated register + first sale, sample purge. Screenshot the finished checklist.

- [ ] **Step 5: Update roadmap + write report** — mark `### 1E Onboarding — ✅ complete 2026-07-13` with the shipped summary + verification; tick `- [ ] Signup-to-first-sale timed run < 15 min`. Write `.superpowers/sdd/1e-report.md`.

- [ ] **Step 6: Commit**

```bash
git add 05-roadmap/phase-1-core-pos-mvp.md
git commit -m "$(printf 'docs(roadmap): 1E Onboarding complete (1E)\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## Self-Review

- **Spec coverage:** migration 0007 (T1) ✓ · signup provisioning + store PATCH (T2) ✓ · sample seed/purge w/ FK-null (T3) ✓ · onboarding status + code echo (T4) ✓ · wizard w/ validation states (T5) ✓ · checklist + empty dashboard (T6) ✓ · E2E + gate + docs (T7) ✓. Decisions 1–4 all reflected.
- **Placeholder scan:** dataset and service logic are concrete; the two admin UI tasks describe exact behavior + reference the mirror files (page components aren't unit-tested in this repo — browser verification is the gate, per prior workstreams).
- **Type consistency:** `SampleDataService.seed/purge`, `OnboardingService.status`, `onboardingApi.*` names are used consistently across tasks; `stores.settings.onboarding` shape (`activation_code`, `activation_expires_at`, `register_id`, `sample_batch_id`, `checklist_dismissed`) is stable throughout.
