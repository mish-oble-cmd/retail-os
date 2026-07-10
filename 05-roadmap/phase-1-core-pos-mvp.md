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

### 1A Catalog (admin + API)

Product/variant CRUD with options matrix, barcodes, images (S3 upload), categories; products list with search; per-location stock field (single location for now). Register grid-layout editor (ADM-16).

### 1B POS data layer

SQLite schema on device (catalog mirror + facts tables); bootstrap download; delta pull (catalog/settings/staff); outbox + pusher v1 (`/sync/bootstrap`, `/sync/changes`, `/sync/batches` minimal happy path + idempotent replay). _The full conflict matrix is Phase 3, but idempotency and atomic outbox writes are NOT deferrable._

### 1C Sell flow (pos-web + Electron)

Sell screen per approved mockup: grid, search, barcode wedge focus-trap; cart ops; discounts sheet (permission ceiling hardcoded to role later); custom sale; park/retrieve; payment screen: cash w/ change + quick amounts, manual card (ref + last4), split tender; receipt: ESC/POS print + email + QR; refunds against local/synced orders; register orders list.

### 1D Shifts & cash

Open/close with counts, paid in/out, over/short, Z-summary printable.

### 1E Onboarding

Signup wizard (store, currency, tax rate, location+register auto-created), sample catalog import offer, activation-code flow for the register, "first sale" checklist on empty dashboard. **Measure: fresh signup → first sale < 15 min.**

### 1F Staff PIN

Staff CRUD (admin), PIN hash sync, PIN lock + attribution on every order (roles/permissions deepen in Phase 2 — Phase 1 roles: Owner/Cashier fixed).

## Acceptance criteria (demo script)

- [ ] Create store, add 20 products via UI + 200 via CSV template (basic import)
- [ ] Activate desktop register with code; cashier PIN login
- [ ] Sell: scan 3 items, apply 10% line discount, park, retrieve, cash payment, correct change, printed + email receipt with tax breakdown
- [ ] Split tender sale (cash + manual card)
- [ ] Refund one line of yesterday's order to cash, restock toggled
- [ ] Kill the network mid-shift → 10 sales complete offline → reconnect → all appear in admin exactly once (pull the plug demo!)
- [ ] Close shift: blind count, over/short shown, Z-report prints
- [ ] Admin: orders list shows the day; order detail timeline correct
- [ ] Signup-to-first-sale timed run < 15 min

## Out of scope (resist!)

Customers, loyalty, promotions engine (only manual discounts), PO/counts/transfers, reports beyond daily summary, mobile app, integrated card terminals, multi-location.
