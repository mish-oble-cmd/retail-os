# 1D Shifts & cash — design

**Phase 1 workstream 1D** · branch `phase-1/sell-flow` (continues the Phase 1 stack) · 2026-07-12

The cash-drawer lifecycle on `pos-web` (Electron-wrapped), offline-first, per the
approved [POS-10 mockup](../../../04-design/mockups/pos--shift.html) and FR-6.1/6.2.
Follows the exact shape 1C established: a device-local entity + outbox facts +
server ingest under RLS + a minimal Admin read view.

## Scope

**In (FR-6.1 / FR-6.2):**

- **Open shift** — count the float (denomination chips accumulate + NumberPad total); **one active shift per register**; the Sell screen is locked until a shift is open. Yesterday's float is a hint, never prefilled (a real count).
- **During shift** — paid in / paid out with reasons; no-sale drawer open (Owner-PIN gated); every completed order is stamped with the open shift.
- **Close shift** — *blind* count (expected stays hidden until the count is submitted) → expected computed → over/short. The over/short **reveal is Owner-gated**; a lone Cashier closing gets "recorded — see your manager."
- **Z-report (FR-6.2)** — gross, net, tax collected, discounts, refunds, tender breakdown, transaction count, per-staff attribution. Computed **on-device at close**, printed offline, and stored server-side exactly as the cashier saw it.
- **Offline:** open / sell / paid-in-out / close / print-Z all work with no network; the facts sync when connectivity returns.

**Out (deferred):**

- Advanced reports & dashboard → Phase 2 (FR-7).
- Cross-register / multi-location consolidation → Phase 4.
- Onboarding wizard (1E) is the next workstream, not part of 1D.

## Decisions (confirmed 2026-07-12)

1. **Order↔shift linkage — stamp `shift_id` on each order** (device + server, new column via migration `0006`). The device stamps the open shift at `recordSale` time. Z = `orders WHERE shift_id = X` — exact, immune to clock skew, re-opens, and midnight rollovers. (Rejected: derive by register + time-window — fragile.)
2. **Z-report — device computes the snapshot at close**, carried in the `shift.closed` fact and stored server-side. Z prints offline, is immutable at close, and Admin shows the exact figures the cashier saw. The server also keeps the raw orders to reconcile. (Rejected: server recompute-on-demand — breaks offline Z, can drift.)
3. **Cash movements — individual `cash.movement` facts.** Each paid-in / paid-out / no-sale is its own auditable fact with reason + staff + timestamp; appears live in Admin; survives even if the shift is never closed. (Rejected: fold into `shift.closed` — no live visibility, lost if the device dies mid-shift.)

## Data model

### Device (`@retailos/sync`, `DEVICE_SCHEMA_VERSION` 2 → 3)

`shifts`

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | ULID |
| `register_id` | TEXT | the device's bound register |
| `location_id` | TEXT | |
| `opened_by_staff_id` | TEXT | |
| `opened_at` | TEXT | ISO |
| `opening_float` | INTEGER | minor units |
| `closed_by_staff_id` | TEXT NULL | |
| `closed_at` | TEXT NULL | |
| `closing_counted` | INTEGER NULL | blind count |
| `closing_expected` | INTEGER NULL | snapshot of the computed expected |
| `over_short` | INTEGER NULL | signed = counted − expected |
| `z_snapshot` | TEXT NULL | JSON Z-report |
| `state` | TEXT | `open` / `closed` |
| `local_seq` | INTEGER | |

- **One open shift per register:** `CREATE UNIQUE INDEX shifts_one_open_per_register ON shifts (register_id) WHERE state = 'open'`.

`cash_movements`

| column | type | notes |
|---|---|---|
| `id` | TEXT PK | ULID |
| `shift_id` | TEXT | |
| `kind` | TEXT | `paid_in` / `paid_out` / `no_sale` |
| `amount` | INTEGER | minor units; `no_sale` amount = 0 |
| `reason` | TEXT | |
| `staff_id` | TEXT | attribution |
| `approved_by_staff_id` | TEXT NULL | Owner who approved a no-sale |
| `client_created_at` | TEXT | |

`orders` gains **`shift_id TEXT`** (nullable for pre-1D rows; stamped at `recordSale`).

### Server (migration `0006_shifts`)

- `shifts` and `cash_movements` tables — tenant PK `(store_id, id)`, FKs to `registers` and `staff` (composite tenant FKs, like 1C), RLS `USING (store_id = current_setting('app.store_id')::uuid)`, GRANTs to `retailos_app` (insert + update-on-close for shifts; insert for cash_movements — append-only in spirit).
- `orders.shift_id` column (nullable, plain reference — no composite unique on shifts to FK against beyond `(store_id, id)`, which we will reference).
- Drizzle table defs mirror the migration.

## Outbox facts (3 new)

Registered in `packages/sync/src/outbox.ts` `toFact` switch, the `SyncBatchBody['facts']` union (`packages/sync/src/http.ts`), and the API discriminated union (`apps/api/src/modules/sync/dto.ts`).

- **`shift.opened`** — `{ id, registerId, locationId, openedByStaffId, openedAt, openingFloat }`
- **`cash.movement`** — `{ id, shiftId, kind, amount, reason, staffId, approvedByStaffId?, clientCreatedAt }`
- **`shift.closed`** — `{ id, closedByStaffId, closedAt, closingCounted, closingExpected, overShort, z }` where `z` is the snapshot below.

**Z snapshot** (integer minor units throughout):
`{ grossSales, netSales, taxCollected, discounts, refunds, txnCount, tenders: { cash, card_manual }, cashRefunds, byStaff: [{ staffId, netSales, txnCount }], openingFloat, paidIn, paidOut, expectedCash, countedCash, overShort }`.

## Domain (`@retailos/domain`, pure, integer-safe)

- `calculateExpectedCash({ openingFloat, cashSales, cashRefunds, paidIn, paidOut }): number`
  = `openingFloat + cashSales − cashRefunds + paidIn − paidOut`.
- `calculateOverShort(counted, expected): number` = `counted − expected` (signed).
- `buildZReport({ orders, refunds, movements, openingFloat, countedCash }): ZSnapshot` — folds the shift's orders/refunds/movements into the snapshot object. Cash-tender detection reads each order's payments; tender breakdown sums by tender kind. Zero external deps.

## Screens (`pos-web`, per POS-10)

App state machine (`App.tsx`) currently `'sell' | 'payment' | 'receipt' | 'orders' | 'refund'`; add **`'shift-open'`** and **`'shift-close'`**. On bootstrap, after PIN login, query the active shift: none → force `'shift-open'`; the Sell screen's Charge path and header only mount behind an open shift.

- **`ShiftOpenScreen`** (POS-10 open) — float `amount-display`, denomination chips that accumulate (`+1000 … +10`), NumberPad for a direct total, "Open shift with ₱X". Writes the `shift.opened` fact.
- **`CashMovementSheet`** — paid in / paid out with amount + reason; **no-sale** drawer open is Owner-PIN gated (reuses `lib/escalation.ts` `verifyOwnerPin`). Each writes a `cash.movement` fact.
- **`ShiftCloseScreen`** (POS-10 close) — blind count entry; expected hidden until submit; then the reconciliation rows (opening float, cash sales, cash refunds, paid in/out, expected, counted) and the over/short **reveal Owner-gated** (lone Cashier: "recorded — see your manager"). "Close shift & print Z-report" → writes `shift.closed` with the Z snapshot, then browser print (reuse 1C `@media print` plumbing in `styles.css`).

Header gets a shift affordance (open-shift indicator + "Close shift" entry), consistent with the existing park/orders header buttons.

## Server ingest (`apps/api/src/modules/sync/sync.service.ts`)

- `ingestShiftOpened(tx, ctx, fact)` — insert shift row (`state = 'open'`); dedupe on `(store_id, id)`; the partial-unique is device-side, server trusts one-open-per-register but tolerates replays.
- `ingestCashMovement(tx, ctx, fact)` — insert; dedupe on id.
- `ingestShiftClosed(tx, ctx, fact)` — update the shift row to `closed` with counted/expected/over_short/z_snapshot; if the shift row is missing (close arrived before open), FK/row-absence rolls back the batch for retry — same posture as 1C refunds referencing a synced order.
- `recordSale` order insert already carries columns; add `shift_id` passthrough.

## Admin (minimal, read-only)

A Shifts list + Z detail under the store (over/short, tenders, per-staff, cash movements). Satisfies the acceptance line "shortages appear … in Admin." No editing. Reuses the existing admin data-fetch patterns; scope kept to a list + detail page.

## Permissions (FR-5.2)

- **Cashier OK:** open own shift, close own shift, paid in / paid out.
- **Owner PIN:** over/short **reveal** at close, **no-sale** drawer open.

Escalation reuses `pos-web/src/lib/escalation.ts` (`verifyOwnerPin`, dual attribution) exactly as 1C refunds/discounts do.

## Error handling & edge cases

- **Double-open guard:** the partial-unique index makes a second `open` insert fail locally; the UI routes an existing open shift straight to Sell.
- **Close with unsynced orders:** Z is computed from local orders (source of truth on the device); sync later reconciles server-side — the snapshot is authoritative for what the cashier saw.
- **No-sale with amount 0:** recorded purely for the audit trail; doesn't affect expected cash.
- **Clock skew / re-open:** irrelevant — attribution is by `shift_id`, not time.
- **Refunds after close:** out of scope for the closed shift's Z (they attribute to the order's original shift only for the cash-refund line during the open window; post-close refunds are a new shift's concern).

## Testing

- **domain:** `expected-cash`, `over-short`, `buildZReport` golden tests (tender split, per-staff, refunds, movements).
- **sync:** one-open-shift-per-register invariant; open → cash.movement → close lifecycle; `shift_id` stamped on `recordSale` orders; Z snapshot fields; fact serialization.
- **api (PGlite):** ingest of the 3 facts; order↔shift linkage; `0006` RLS grants on real-ish PG; close-before-open rollback.
- **Live E2E** (`.superpowers/sdd/1d-e2e.mjs`): activate device → open shift → push cash + card sales (stamped `shift_id`) → paid-out → blind close with counted ≠ expected → assert `over_short` + Z snapshot round-trip to Postgres → Admin shows the shift. Reuses the 1C harness scaffolding.

## Task breakdown

- **T1** domain — expected-cash / over-short / Z-report primitives + tests.
- **T2** device layer — schema v3 (`shifts`, `cash_movements`, `orders.shift_id`), open/close/paid-in-out/no-sale functions, 3 outbox facts, active-shift + Z queries, stamp `shift_id` on `recordSale`.
- **T3** server ingest — migration `0006_shifts` + Drizzle, 3 fact handlers, order-shift linkage, RLS.
- **T4** pos-web open-shift screen + Sell gate.
- **T5** pos-web paid-in/out + no-sale (Owner PIN).
- **T6** pos-web close-shift + over/short reveal (Owner gate) + Z-report print.
- **T7** admin shifts list + Z detail (read-only).
- **T8** E2E + full-repo gate + docs close-out.

## References

- `04-design/mockups/pos--shift.html` (POS-10, approved 2026-07-10)
- `02-product/feature-requirements.md` FR-6.1 / FR-6.2, FR-5.2 roles
- `05-roadmap/phase-1-core-pos-mvp.md` §1D
- 1C precedent: `docs/superpowers/plans/2026-07-12-1c-sell-flow.md`
