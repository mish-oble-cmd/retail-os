# Data Model

Core entities, inspired by Shopify's proven object model (see `01-research/shopify-platform-architecture.md` §3) with offline-first adaptations. This is the logical model; concrete Drizzle schemas live in `apps/api/src/db/` once built. POS SQLite mirrors a subset (marked ⬇ synced down, ⬆ produced locally).

## Global conventions

- PK: `id` ULID (client-generatable). FK columns named `<entity>_id`.
- Every business table: `store_id` (tenant), `created_at`, `updated_at`; synced tables add `sync_rev` (server-assigned monotonic revision per store, drives delta sync).
- Money: `*_amount` integer minor units; store has one `currency` (v1 single-currency per store).
- Soft delete via `status`/`deleted_at` only where noted; sale facts are **immutable — corrections are new rows**.
- **Intra-tenant FKs are composite** `(store_id, <entity>_id) REFERENCES parent(store_id, id)` (decided 2026-07-10): Postgres referential-integrity checks bypass RLS, so a single-column FK would let one tenant reference another tenant's row. Composite FKs make cross-tenant references impossible at the constraint level; every referenceable table carries a `UNIQUE (store_id, id)` constraint.

## Entity relationship overview

```
Store ─┬─ Location ─┬─ Register ─── Shift ─── ShiftEvent
       │            └─ InventoryLevel
       ├─ Staff ─── Role
       ├─ Category ── Product ─── Variant ─┬─ Barcode
       │                                   └─ InventoryLevel / StockMovement
       ├─ Supplier ── PurchaseOrder ── POLine
       ├─ Transfer ── TransferLine        ├─ CountSession ── CountLine
       ├─ Customer ─┬─ LoyaltyAccount ── LoyaltyTransaction
       │            └─ Order ─┬─ OrderLine
       │                      ├─ Payment
       │                      ├─ Refund ── RefundLine
       │                      └─ FulfillmentInfo (P4, BOPIS-lite)
       ├─ Promotion / DiscountCode
       ├─ TaxRate / TaxCategory / Tender (settings)
       ├─ ApiKey / WebhookSubscription / WebhookDelivery
       └─ SyncClient / SyncBatch / SyncConflict / AuditLog
```

## Key tables (fields abridged to the load-bearing ones)

### Identity & topology

- **Store**: name, currency, timezone, price_mode(`tax_inclusive|tax_exclusive`), plan, settings JSONB
- **Location** ⬇: name, address, timezone, tax_profile_id, active
- **Register** ⬇: location_id, name, device binding (activated sync_client_id), grid_layout JSONB
- **Staff** ⬇: name, email?, password_hash? (argon2id; back-office users only — register-only staff have PIN but no password; never synced down to POS devices), pin_hash, role_id, totp_secret? (encrypted; 2FA optional Phase 0, enforced for Owner from Phase 1), active | **Role** ⬇: name, permissions JSONB (incl. `max_discount_pct`, `can_refund`, `can_void`, `can_open_drawer`, …)

### Catalog ⬇

- **Product**: name, description, category_id, brand, images[], options JSONB (ordered option definitions, e.g. `[{"name":"Size","values":["S","M","L"]}]` — variants hold the chosen combination in `option_values`; added 2026-07-10 for the FR-2.2 matrix), tax_category_id, status, has_variants, custom JSONB
- **Variant**: product_id, option_values JSONB, sku, price_amount, compare_at_amount?, cost_amount?, track_stock bool
- **Barcode**: variant_id, code (unique per store) — multiple per variant
- **Category**: parent_id (tree), name, sort
- **ModifierGroup / Modifier** (P4): min/max, price_delta_amount
- **Promotion**: type (`pct|fixed|bogo`), scope (cart|category|product), conditions JSONB, schedule, stackable | **DiscountCode**: promotion_id, code, usage_limit

### Inventory

- **InventoryLevel** ⬇: variant_id, location_id, on_hand, reserved (P4), reorder_point?, reorder_qty? — _projection of movements_
- **StockMovement** ⬆(sales)/server(ops): variant_id, location_id, qty_delta, type(`sale|refund_restock|adjustment|receive|transfer_out|transfer_in|count`), reason?, ref (order_id/po_id/…), staff_id — **immutable ledger**
- **Supplier / PurchaseOrder / POLine**: status(`draft|ordered|partial|received|closed`), expected_at; POLine: qty_ordered, qty_received, unit_cost_amount
- **Transfer / TransferLine**: from/to location, status(`draft|in_transit|received|discrepancy`)
- **CountSession / CountLine**: scope filters, status; line: expected, counted, variance

### Customers & loyalty

- **Customer** ⬇⬆: name, phone (lookup key), email?, tags[], note, consent flags, custom JSONB
- **LoyaltyAccount**: customer_id, points_balance | **LoyaltyTransaction**: delta, type(`earn|redeem|adjust`), order_id?

### Sales facts (all ⬆, immutable)

- **Order**: register_id, location_id, staff_id, customer_id?, number (per-location sequence with register prefix, e.g. `R2-000481`, assigned locally — see sync doc), state(`completed|partially_paid|refunded|partially_refunded|voided`), subtotal/discount/tax/total amounts, tax_lines JSONB, note, source(`pos|api`), client_created_at, idempotency_key
- **OrderLine**: variant_id? (null = custom sale), name snapshot, qty (×1000 for weight later), unit_price_amount snapshot, line discounts JSONB, tax JSONB, cost_snapshot_amount (margin reporting)
- **Payment**: order_id, tender_type, amount, change_amount (cash), provider ref/status (card), captured_at
- **Refund / RefundLine**: order_id, amounts, restock flags, reason, approved_by staff_id
- **Shift**: register_id, staff_open/close, opened_at/closed_at, float_amount, counted_amount, expected_amount, over_short_amount | **ShiftEvent**: type(`paid_in|paid_out|no_sale|drop`), amount, reason

### Platform

- **ApiKey**: hashed key, scopes[], last_used | **WebhookSubscription**: url, topics[], secret | **WebhookDelivery**: payload, attempts, status
- **SyncClient**: device fingerprint, register_id, last_seen, last_ack_rev | **SyncBatch**: client_id, idempotency_key, payload hash, status | **SyncConflict**: type, entities, resolution, resolved_by
- **AuditLog**: actor, action, entity ref, before/after JSONB (sensitive actions only)

### Sync plumbing (concrete 1B tables, 2026-07-11)

- **devices** (realizes SyncClient): register_id, token_hash (sha-256 of the `rot_…` device token, shown once at activation), app_version, activated_at, last_seen_at, revoked_at
- **sync_batches** (realizes SyncBatch): PK (store_id, batch ULID) = the idempotency key; register_id, device_id, fact_count, stored `acks` JSONB replayed verbatim on duplicate delivery
- **sync_conflicts** (realizes SyncConflict): conflict_type (`total_mismatch`, `stale_reference`, … full matrix Phase 3), entity_type/entity_id, details JSONB, resolved_at/resolved_by
- **sync_tombstones**: (store_id, entity_type, entity_id) + sync_rev — written by `AFTER DELETE` triggers on ⬇-synced tables so deletions ride the delta feed

## Invariants (enforce in domain package + DB constraints)

1. `sum(OrderLine totals) + tax == Order.total` — server recomputes on ingest; mismatch → SyncConflict, never silent fix
2. `sum(Payments) - sum(Refunds) == paid amount consistent with Order.state`
3. `InventoryLevel.on_hand == Σ StockMovement.qty_delta` per (variant × location) — rebuildable projection
4. Order/Payment/StockMovement/Shift rows are never UPDATEd after finalization (except server-set `sync_rev`/status transitions); corrections append
5. Unique `(store_id, idempotency_key)` on orders & sync batches — replays are no-ops
6. Refund lines can't exceed remaining refundable qty per line

## Tax computation (locked decision)

Per-line: rate applied to discounted line amount, rounded half-up to minor unit; order tax = Σ line taxes; tax-inclusive mode extracts tax from gross (`tax = gross - gross/(1+rate)`, rounded). Multi-rate lines supported via tax_lines array. Implemented once in `@retailos/domain/tax.ts`, golden-tested (see testing strategy).

Phase 0 clarifications (approved 2026-07-08):

- Rates are stored/computed as **integer basis points** (12% = 1200 bp); all tax math is integer-only (`round_half_up(amount × rate_bp / 10000)`), no floats anywhere.
- "Half-up" = round half **away from zero** (negative amounts, e.g. refunds, mirror positive rounding).
- **Multi-rate exclusive**: each rate applies independently to the discounted line amount, each rounded half-up.
- **Multi-rate inclusive**: net = gross / (1 + Σrates); each `tax_i = round_half_up(gross × rate_i_bp / (10000 + Σrate_bp))`. Any residual cent between `gross - net - Σtax_i` stays in net (never invented tax).
- **Cart-level discounts** are allocated across lines proportionally to line amounts (largest-remainder method so no cent is lost) _before_ tax computes — tax always sees discounted line amounts.
- **Canonical demo tax setup** (updated 2026-07-10 — first client is Singapore): **SGD currency, 9% GST, tax-inclusive**. Currency and rates remain per-store settings (integer basis points, inclusive/exclusive switchable), so any market is configurable without code changes. Golden fixtures center on SGD 9% inclusive; the original PHP 12% inclusive cases stay in the suite alongside exclusive/multi-rate/zero-rate cases.
