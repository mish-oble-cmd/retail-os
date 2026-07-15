# 1E Onboarding — design

**Phase 1 · workstream 1E (last of Phase 1) · FR-10.1 · screen ADM-01**
**Date:** 2026-07-13 · **Branch:** `phase-1/sell-flow`

## Goal

Fresh signup → first sale in **under 15 minutes**. Replace the Phase-0 single-card
signup with the approved **ADM-01** flow: a 3-step wizard (Account → Store profile →
Starting catalog), then a **first-sale checklist** on Home rendered over an
**empty-state dashboard**. The wizard chrome and checklist follow the approved mockup
`04-design/mockups/admin--signup-onboarding.html` exactly; only the sample dataset
*content* differs (see Decision 1).

Success is the demo-script line: **"Signup-to-first-sale timed run < 15 min"**
(`05-roadmap/phase-1-core-pos-mvp.md`).

## Confirmed decisions

1. **Sample catalog = Singapore SGD.** The roadmap's canonical first client is
   Singapore (SGD, 9% GST tax-inclusive), so the shipped sample dataset is the
   **~40-product Singapore convenience-store set in SGD**, not the Filipino sari-sari
   copy shown in the approved mockup. The mockup's product names/currency are treated
   as **illustrative only**; its layout, steps, validation states, and checklist
   structure are authoritative. Amounts are integer minor units applied under the
   store's currency (no FX) — correct for the canonical SGD store, still functional as
   a test drive for any other currency.
2. **Sample data marked with `sample_batch_id`** (nullable) on the seeded rows, so a
   one-click purge deletes exactly that batch and nothing else. Practice sales stay as
   ordinary orders; purge nulls the `order_lines.variant_id` FK on any line that
   referenced a purged variant (the line already snapshots name + unit price, so order
   history and reports are preserved). "Never mixes into reports after deletion" holds.
3. **Empty-state dashboard only.** The real dashboard StatCards + sales-by-hour chart
   are **ADM-02 (Phase-1 priority 2)** and stay out of 1E. 1E ships the em-dash
   empty-state exactly as the mockup's Section 4 shows.
4. **Address capture is out of scope.** `stores` has no address columns; the <15-min
   path and MVP receipts (1C) don't need them. The mockup's address fields are
   deferred to a later Settings pass; the wizard omits them.

## Data model — migration `0007_sample_data`

Add a nullable `sample_batch_id text` to the catalog tables the seeder touches:

- `products.sample_batch_id`
- `variants.sample_batch_id`
- `categories.sample_batch_id`
- `inventory_levels.sample_batch_id`

Plus a partial index per table `WHERE sample_batch_id IS NOT NULL` for fast purge.
RLS policies and role grants mirror the existing catalog tables (the columns live on
already-protected tables, so no new policy is needed — only the columns + indexes).
Drizzle `schema.ts` updated to match; the column is `text('sample_batch_id')`
(nullable), a ULID identifying the seed batch.

No new table: the batch id lives on the rows; the *active* batch id for a store is
recorded in `stores.settings.onboarding.sample_batch_id` so purge is one lookup.

## Signup expansion

`POST /auth/signup` (cross-tenant, one transaction — unchanged shape) gains:

- **`name`** — the owner's display name (currently derived from the email local-part).
  `staff.name` uses it; falls back to the local-part when absent.
- **Auto-provision the register loop** in the same tx, so the checklist has a real
  activation code the moment signup returns:
  - a **"Main"** location,
  - a **"Register 1"** register (empty grid),
  - an **activation code** via the existing `issueActivationCode` path (sha-256 hash
    stored; **plaintext code + `expires_at` echoed into
    `stores.settings.onboarding`**). The plaintext echo is owner-session-only (returned
    solely by `GET /onboarding/status`) and **cleared when the register's device
    activates**. Tradeoff recorded: the owner's own bootstrap code lives in their
    store settings until redeemed or expired — acceptable for a self-serve store setup.

Store **profile** (name, currency, timezone, `price_mode`) is written at **wizard
step 2** via the existing settings surface (a store-profile `PATCH`; added if not
already present as `PATCH /settings/store`). Step 1 creates the account with a
placeholder store name; step 2 finalizes it. Currency/timezone arrive prefilled from
the browser locale ("detected") per the mockup.

`signupSchema` (zod) gains `name: z.string().min(1).max(120)`. Existing
`store_name`/`currency` stay (step 1 may pass a provisional store name; step 2's
profile PATCH is the source of truth).

## Sample catalog — `SampleDataService`

- **Dataset**: `sample-catalog.sg.ts` — ~40 Singapore convenience-store products
  (kopi, kaya, Milo, Maggi, canned drinks, snacks, toiletries…) with categories,
  barcodes, SGD prices (integer cents), starting stock, and a register grid layout.
  Pure data module, no logic, so it's trivially reviewable and swappable.
- **`seed(storeId)`** → allocates one `sampleBatchId`, inserts categories → products →
  variants → barcodes → inventory levels (all stamped), sets `Register 1`'s
  `grid_layout` to the arranged tiles, records `sampleBatchId` in
  `stores.settings.onboarding`. Idempotent guard: refuses if a batch already exists.
  Uses the store's tax "Standard" category (seeded at signup) so tax works out of the box.
- **`purge(storeId)`** → reads the batch id, **nulls `order_lines.variant_id`** for any
  line pointing at a batch variant, deletes inventory levels → barcodes → variants →
  products → categories in the batch, resets `Register 1`'s grid, clears the settings
  key. Everything server-side; the device picks up the deletions via the existing
  `/sync/changes` tombstone feed.
- **Endpoints**: `POST /onboarding/sample-catalog` (seed), `DELETE
  /onboarding/sample-catalog` (purge). Owner-session gated.

## Onboarding status — `GET /onboarding/status`

Derives the 5 checklist steps from existing data (no new state to drift):

| Step | Done when | Source |
|------|-----------|--------|
| Create your account | always (session exists) | session |
| Set up your store | store row present | `stores` |
| Load a starting catalog | product count > 0 | `products` (optional/skippable) |
| Connect a register | any register has an activated device | `devices` |
| Ring up your first sale | order count > 0 | `orders` |

Response also carries: the echoed **activation code + expiry** (while unredeemed), the
store's currency/name for the headline, and a **remaining-time estimate** derived from
the count of not-yet-done steps (matches the mockup's "first sale in ~N more minutes").
The "first sale" step is reported **blocked** (with reason) until a register connects.

## Admin UI

### Wizard (`/signup` → stepped)

A single client route driving three steps (URL step param or local state):

1. **Account** — your name, email, password (min 10, live count in the hint), Terms
   line. Validation states from the mockup: duplicate email → inline "sign in instead?"
   link; short password → rule + current count; primary button **disables in place**,
   2px danger border reusing the product-editor validation pattern. Submits
   `POST /auth/signup`.
2. **Store profile** — store name, currency (prefilled/detected), timezone
   (prefilled/detected), **Prices include VAT / Add VAT at the till** segmented control
   (→ `price_mode`), reassurance line ("changeable later in Settings"). Submits the
   store-profile PATCH.
3. **Starting catalog** — two choice cards: **Load the sample catalog** (recommended,
   preselected, mini product-chip preview) vs **Start with an empty catalog** (CSV
   hint). "Finish setup" → optionally `POST /onboarding/sample-catalog`, then routes to
   Home.

Wizard uses the bare centered stage from the mockup (no AppShell — there's nothing to
navigate yet), a 3-dot step indicator, and the RetailOS wordmark header.

### Home (`/dashboard`) — checklist + empty state

Replaces the Phase-0 placeholder, adopting `AppShell` like the other admin pages:

- **First-sale checklist card** — headline counts down **time, not tasks**
  ("First sale in about N more minutes · X of 5 done"), a progress bar, done items
  collapsed to one line, the two live items carrying their own instructions: **Connect
  a register** shows the activation code inline (mono, with expiry) + "Show full
  instructions"; **Ring up your first sale** is **disabled with a reason**
  ("Waiting for a register") until a device connects. An "I've done this before — hide"
  control dismisses the card (persist dismissal in `stores.settings.onboarding`).
- **Empty-state dashboard** beneath — em-dash StatCards (Revenue today, Transactions,
  Average basket) and an empty chart with the cause-and-effect promise
  ("Your first sale lights this up"). Polls `GET /onboarding/status` so steps flip as
  the device activates and rings a sale.

## Task breakdown

- **T1** — migration `0007_sample_data` + Drizzle `schema.ts` (`sample_batch_id` on 4
  tables + partial indexes). PGlite migration test.
- **T2** — signup expansion: `name`, auto Main location + Register 1 + activation code
  (plaintext echo into `stores.settings.onboarding`), store-profile PATCH surface.
  Service + dto + PGlite tests.
- **T3** — `SampleDataService` + `sample-catalog.sg.ts` dataset + seed/purge endpoints;
  purge nulls `order_lines.variant_id`. PGlite tests (seed stamps batch, purge cleans
  up, practice order survives).
- **T4** — `GET /onboarding/status` (derived steps + code echo + time estimate).
  PGlite tests for each flag transition.
- **T5** — admin 3-step wizard with the mockup's validation states.
- **T6** — admin Home first-sale checklist + empty-state dashboard (AppShell, polling).
- **T7** — E2E (signup → sample seed → activate → first sale, asserting each checklist
  flag flips + purge integrity) + full-repo gate + roadmap update + close-out report.

## Verification

- Full-repo gate `pnpm turbo typecheck lint test` green.
- Browser walkthrough: complete the wizard (both catalog choices), land on Home, watch
  the checklist reflect an activated register + first sale, exercise sample purge.
- **Live E2E over real Postgres** timing signup → sample seed → device activate →
  first sale; assert onboarding-status flags flip in order and purge nulls the sold
  variant's FK without corrupting the order. Report to `.superpowers/sdd/1e-report.md`.

## Out of scope (resist)

Real dashboard analytics (ADM-02), address capture, billing/plan (ADM-18), CSV import
of *user* products (already shipped in 1A — the wizard only links to it), multi-store
accounts.
