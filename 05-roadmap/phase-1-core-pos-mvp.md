# Phase 1 — Core POS MVP

**Goal:** a single-location store can sell all day: scan/search → cart → cash/manual-card → receipt → shift close. Local-queue resilience from day one (full offline certification is Phase 3).

**FRs:** FR-1.1–1.8, FR-1.9 (queue level), FR-2.1–2.2 (basic), FR-3.1 (sales ledger), FR-5.1 (PIN), FR-6.1–6.2, FR-10.1, FR-10.2 (core settings), manual card tender.

## Kickoff decisions (2026-07-09)

Adopted at Phase 1 kickoff (proposed by AI, standing unless vetoed by user):

1. **CSV "basic import" scope** → FR-2.6 Phase 1 subset note in `02-product/feature-requirements.md`
2. **Cashier permission ceiling** (10% discount; Owner PIN escalation for refunds/voids/overrides) → FR-5.2 Phase 1 note
3. **Local order retention 60 days; POS refunds are same-register only** → `03-architecture/offline-sync-strategy.md`
4. **Browser `pos-web` printing is best-effort** (ESC/POS = Electron/RN only) → offline-sync-strategy browser caveat
5. **Object storage dev = MinIO** (S3-compatible adapter; prod provider at deploy) → tech-stack
6. **Email dev = Mailpit; QR receipt page = admin app `/r/<order-ulid>`** → tech-stack

## Phase 1 start decisions (2026-07-10, user-approved)

1. **Workstream order: 1A → 1B → 1F → 1C → 1D → 1E** (catalog first, onboarding last — it stitches the loop and the <15-min measure needs everything working)
2. **Browser `pos-web` is online-preferred in Phase 1**: the offline queue targets Electron (better-sqlite3) only; browser gets a brief IndexedDB queue + warning banner. wa-sqlite/OPFS moves to Phase 3 hardening.
3. **First client is Singapore** → canonical demo/sample setup is **SGD, 9% GST tax-inclusive**; currency + tax stay per-store adjustable (see `data-model.md` §Tax). Sample catalog (1E) = ~40-product Singapore convenience-store dataset in SGD.
4. **POS auto-lock 90 s** (cart preserved) → FR-5.1 note; **activation codes** 8-char Crockford base32, single-use, 24 h expiry → offline-sync-strategy.

Phase 0 carry-over — deferral schedule approved 2026-07-10 (details in `phase-0-foundations.md` exit criteria):

- **Hosted deploy of API/admin/Storybook** → due end of Phase 1, before Phase 1 code review (user provides Fly.io + Vercel credentials, ~30 min)
- **Interactive Electron print verification** → due during workstream 1C, as part of receipt acceptance testing (user runs `pnpm dev --filter pos-desktop`, ~15 min)
- **Expo device barcode-scan verification** → due at Phase 3 kickoff (user tests via Expo Go on phone, ~5 min)

## Mockup gate (before implementation)

POS-01, 02, 05, 06, 07, 08, 10, 12, 13, 14 · ADM-01, 03, 04, 05, 11, 16, 17 (POS-03/04 already approved in Phase 0).

**Gate cleared 2026-07-10** — all Phase 1 screens mocked and approved; statuses in `04-design/screen-inventory.md`. Implementation may begin.

## Workstreams

### 1A Catalog (admin + API) — ✅ complete 2026-07-11

Product/variant CRUD with options matrix, barcodes, images (S3 upload), categories; products list with search; per-location stock field (single location for now). Register grid-layout editor (ADM-16).

_Shipped on `phase-1/catalog`: catalog/settings schema + RLS migrations, products/variants/barcodes/categories/tax-categories API, CSV import/export (FR-2.6 subset), MinIO presigned image upload, locations/registers + activation codes API, admin screens ADM-03/04/05/16, 76 API tests. Verified end-to-end against local Postgres (signup → product with variant matrix → mixed CSV import report → barcode search → activation code → grid layout). Found+fixed in verification: tenant wrapper now drops to `retailos_app` per transaction — dev superuser connections previously bypassed RLS._

### 1B POS data layer — ✅ complete 2026-07-11

SQLite schema on device (catalog mirror + facts tables); bootstrap download; delta pull (catalog/settings/staff); outbox + pusher v1 (`/sync/bootstrap`, `/sync/changes`, `/sync/batches` minimal happy path + idempotent replay). _The full conflict matrix is Phase 3, but idempotency and atomic outbox writes are NOT deferrable._

_Shipped on `phase-1/sync`: 0003_sync migration (devices, tombstones, order/payment facts, sync_batches dedupe, sync_conflicts, sync_rev on phase-0 tables), `/sync/activate|bootstrap|changes|batches` API (29 new API tests incl. replay + tenant-leak suites), `@retailos/sync` engine — better-sqlite3 device schema, atomic outbox, pusher with persisted batch idempotency keys, SyncClient facade (17 tests against an in-memory fake server). Verified end-to-end against local Postgres: signup → register activation → bootstrap → offline sale (domain math) → push → lost-ack replay + new-batch refire both dedupe → catalog change pulls down; final DB state: 1 order/1 line/1 payment, 0 conflicts, stock 100→98._

**1B kickoff decisions (2026-07-11, proposed by AI, standing unless vetoed):** _(details + plan: `docs/superpowers/plans/2026-07-11-1b-pos-data-layer.md`)_

1. Device auth: `POST /sync/activate` exchanges the one-time code for an opaque `rot_…` device token (sha-256 hash stored in new `devices` table); `activation_codes.code_hash` becomes globally unique so codes resolve without a store id
2. Deletions sync via a `sync_tombstones` table written by `AFTER DELETE` triggers on every ⬇-synced table
3. `stores/locations/registers/staff/roles` gain `sync_rev`; staff syncs down as a projection (`id, name, role_id, pin_hash, active` — never password/TOTP)
4. Facts storage lands now: `orders`/`order_lines`/`payments` + `sync_batches` (batch dedupe, stored acks) + `sync_conflicts`; refund/shift facts arrive with 1C/1D
5. Ingest revalidation v1: recompute totals via `@retailos/domain`; mismatch → `total_mismatch` conflict, unknown rate → `stale_reference` — fact always accepted
6. Client device-token storage is pluggable (`SecretStore`); SQLite-backed default, OS-keychain adapter with the 1C Electron wiring; better-sqlite3 is an optional lazy peer dep of `@retailos/sync`
7. Known delta-feed race (uncommitted-rev skip under concurrent writers) accepted at Phase 1 volume; Phase 3 hardening revisits
8. Customers excluded from bootstrap/changes until Phase 2 (no customers table yet)

### 1C Sell flow (pos-web + Electron) — ✅ complete 2026-07-12

Sell screen per approved mockup: grid, search, barcode wedge focus-trap; cart ops; discounts sheet (permission ceiling hardcoded to role later); custom sale; park/retrieve; payment screen: cash w/ change + quick amounts, manual card (ref + last4), split tender; receipt: ESC/POS print + email + QR; refunds against local/synced orders; register orders list.

_Shipped on `phase-1/sell-flow` (full report: `.superpowers/sdd/1c-report.md`): the cashier's core loop on `pos-web` over the offline-first device store. **Domain** — `calculateRefund` (proportional, integer-safe, restock deltas) + `formatSaleNumber`. **`@retailos/sync`** — device `parked_carts` + park/retrieve/discard (local-only), `recordRefund` outbox fact (`refund.completed`, derived order state, restock via the existing `stock.movement` path), `queries.ts` reads (grid, barcode, search, orders history, order detail w/ per-line `refundedQty`), and a **sql.js + best-effort OPFS snapshot** browser driver (`openBrowserDriver`, degrades to in-memory). **API** — migration `0005_refunds` (RLS/tenant FKs/append-only grants), `refund.completed` ingest (order-state derivation + restock projection), and a public receipt surface `GET/POST /public/receipts/:id[/email]` (cross-tenant resolve → RLS read; Mailpit mailer). **admin** — public `/r/[orderId]` receipt page. **pos-web** — POS-03 Sell, POS-14 discount + POS-13 custom sale (Owner-PIN escalation over the Cashier 10% ceiling, dual attribution), POS-04 Payment (cash/card/split → `recordSale`), POS-05 Receipt (QR + print + email + auto-return), POS-06 park/retrieve (collision re-park), POS-07 orders + POS-08 refund (line-level, "N of M", per-line restock, Owner-PIN gate). Full-repo gate green (`typecheck lint test`, 33/33 tasks; domain 77, sync 40, api 124, pos-web 3). Every screen browser-verified against the real sql.js/OPFS store (incl. a sale surviving an OPFS reload). **E2E: PASS — 21/21** against real Postgres + Mailpit (`.superpowers/sdd/1c-e2e.mjs`): device activate → push sale facts (order completed, inventory 40→38) → push refund facts (order → `partially_refunded`, refund rows confirm the `0005` RLS grants on real PG, inventory 38→39) → idempotent replay → `/public/receipts/:id` → email delivered to Mailpit. Exchange, integrated card terminals, and certified browser offline (wa-sqlite worker) remain later-phase._

**1C kickoff decisions (2026-07-12, user-approved):** _(plan: `docs/superpowers/plans/2026-07-12-1c-sell-flow.md`)_

1. **Browser store is real** — the Sell flow runs against the `@retailos/sync` `SqlDriver` port; `pos-web` gets a browser driver so a plain browser persists offline too. _Refined 2026-07-12:_ the `SqlDriver` interface is **synchronous** (the outbox atomicity guarantee depends on it) but durable OPFS access is async, so the driver is **sql.js (SQLite-in-wasm, synchronous)** with **best-effort OPFS snapshot** persistence after each commit — degrading to pure in-memory (and reporting `persistent: false`) when OPFS is unavailable. This matches `offline-sync-strategy.md`: browser pos-web is online-preferred, **not certified for extended offline** (certified offline = Electron `better-sqlite3` + RN). A true per-transaction wa-sqlite worker driver is Phase-3 offline-hardening territory. The shared UI never knows which driver backs it.
2. **Full receipt loop in 1C** — POS-05 email (Mailpit dev adapter) + QR to the admin public route **`/r/<order-ulid>`** are built end-to-end, not stubbed. ESC/POS thermal printing stays the Electron-only path (browser offers the native print dialog), verified interactively during 1C.
3. **Refund facts land now** — a `refund.completed` outbox fact + server ingest + inventory restock projection (1B deferred refund facts to 1C/1D). **Exchange is Phase 2** (screen inventory POS-08 "exchange 2").
4. **Owner PIN escalation** gates the Phase-1 fixed-role ceilings at the register (discount >10% line/cart, refunds, voids, tax-exempt, no-sale drawer) — reuses the 1F `PinPad` + `verifyPin` against an Owner. Full permission editor + queryable audit log UI arrive with FR-5.2/5.3 in Phase 2.
5. **Parked carts are device-local** — a `parked_carts` SQLite table on the register, per FR-1.7 (named, per-register, survive restart); not part of the sync outbox.
6. **Task order:** domain sell/refund primitives → device data-layer additions (`parked_carts`, refund fact, wa-sqlite driver) → POS-03 Sell → POS-14 discount + POS-13 custom sale → POS-04 Payment → POS-05 Receipt (+ `/r` page + email) → POS-06 park/retrieve → POS-07 orders → POS-08 refund (+ escalation) → E2E + close-out.

### 1D Shifts & cash

Open/close with counts, paid in/out, over/short, Z-summary printable.

### 1E Onboarding

Signup wizard (store, currency, tax rate, location+register auto-created), sample catalog import offer, activation-code flow for the register, "first sale" checklist on empty dashboard. **Measure: fresh signup → first sale < 15 min.**

### 1F Staff PIN — ✅ complete 2026-07-12

Staff CRUD (admin), PIN hash sync, PIN lock + attribution on every order (roles/permissions deepen in Phase 2 — Phase 1 roles: Owner/Cashier fixed).

_Shipped on `phase-1/staff-pin`: fixed Cashier role (signup seed + `0004` migration backfill for pre-existing stores), `verifyPin` offline argon2id check in `@retailos/domain` (hash-wasm, device-verifiable against the server-issued argon2 hash), `StaffService` CRUD with guards (Owner-only `staff_edit` gate, self-demote guard, last-owner guard) + `setPin`, `/staff` (`GET` list, `POST`, `PATCH`) + `POST /staff/{id}/pin` + `GET /roles` API with OpenAPI, admin Settings → Staff page (list/create/edit/deactivate + PIN set/reset), `staffId` now required on `recordSale` (attribution on every order, `@retailos/sync`), and a real POS-02 PIN lock screen (`MAX_ATTEMPTS=5` / `COOLDOWN_MS=30_000` throttle, 90 s idle auto-lock). Tests substantiated by the full-repo gate run: `identity.service.test.ts` (5), `staff.service.test.ts` (11, incl. setPin invariants — device-verifiable hash, `sync_rev` bump), `pin.test.ts` (3, `verifyPin` golden path), `pin-lock.test.ts` (3, throttle state machine), `outbox.test.ts` (9, incl. staffId-required on `recordSale`) — 210 tests passing repo-wide, full gate (`typecheck lint test`, 32/32 tasks) green. E2E: PASS — 25/25 assertions against real Postgres (colima brought up mid-verification): signup → Cashier role → Alice + PIN set → `has_pin: true` with no `argon2`/`pin_hash` leak in the admin response → location/register/activation code → real `SyncClient` activate + bootstrap → device SQLite staff mirror → `verifyPin('0042', hash) === true`, `verifyPin('1111', hash) === false` (the 1F golden path) → `recordSale` with `staffId` → `sync()` → `psql` confirms `orders.staff_id` = Alice → `PATCH active:false` → `sync()` pull → device mirror `active = 0`. Full script + report: `.superpowers/sdd/task-10-report.md`._

## Acceptance criteria (demo script)

- [ ] Create store, add 20 products via UI + 200 via CSV template (basic import)
- [ ] Activate desktop register with code; cashier PIN login
- [x] Sell: scan 3 items, apply 10% line discount, park, retrieve, cash payment, correct change, printed + email receipt with tax breakdown _(1C)_
- [x] Split tender sale (cash + manual card) _(1C)_
- [x] Refund one line of yesterday's order to cash, restock toggled _(1C)_
- [ ] Kill the network mid-shift → 10 sales complete offline → reconnect → all appear in admin exactly once (pull the plug demo!)
- [ ] Close shift: blind count, over/short shown, Z-report prints
- [ ] Admin: orders list shows the day; order detail timeline correct
- [ ] Signup-to-first-sale timed run < 15 min

## Out of scope (resist!)

Customers, loyalty, promotions engine (only manual discounts), PO/counts/transfers, reports beyond daily summary, mobile app, integrated card terminals, multi-location.
