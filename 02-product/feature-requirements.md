# Feature Requirements (PRD)

Authoritative functional requirements for RetailOS. Each requirement has an ID (`FR-x.y`) used by phase plans and tests. User stories (`US-xx`) reference `02-product/personas-and-user-stories.md`. Phases reference `05-roadmap/phases-overview.md`.

Conventions: all money in minor units (integer). All timestamps UTC ISO-8601, displayed in store timezone. All entities scoped to `store_id`.

---

## FR-1 Selling / Register (US-01…10) — Phase 1, offline hardening Phase 3

- **FR-1.1 Cart**: add by barcode scan (keyboard-wedge + camera on mobile), fuzzy search (name/SKU), tap grid (user-arrangeable tiles, per-register layout). Line ops: qty ±, remove, note, price override (permission-gated, reason required).
- **FR-1.2 Discounts**: line-level and cart-level; % or fixed; permission threshold per role; itemized on receipt; automatic promotions and codes evaluated by shared rules engine (`@retailos/domain`) so results are identical offline.
- **FR-1.3 Custom sale**: ad-hoc line with name, price, tax category. Flagged in reports.
- **FR-1.4 Taxes**: per-location tax rates; inclusive or exclusive pricing (store-level setting); per-product tax category; tax-exempt sale (permission + reason). Rounding: half-up per line, totals from line sums (document any deviation in `data-model.md`).
- **FR-1.5 Tenders**: cash (denominación shortcuts, change calc), card (MVP: manual record with reference; Phase 4: integrated terminal), gift/store credit (Phase 4), custom tenders (bank transfer, e-wallet — configurable list). Split payments across tenders. Partial payment = order state `partially_paid` (layaway, Could).
- **FR-1.6 Receipts**: ESC/POS print (58/80mm), email, QR-to-web receipt. Template: logo, store fields, tax breakdown, custom header/footer. Gift receipt (no prices).
- **FR-1.7 Park/retrieve** carts, named, per register, survive restarts (local persistence).
- **FR-1.8 Returns/refunds/exchanges**: lookup order (receipt #, QR scan, customer, date); refund whole/partial to original tender or cash; restock toggle per line; exchange = refund + new sale linked; manager approval over role limit.
- **FR-1.9 Offline guarantee**: FR-1.1…1.8 fully functional with zero connectivity, minimum 7 days offline, using last-synced catalog. See `03-architecture/offline-sync-strategy.md`.

## FR-2 Catalog (US-11, 12, 19) — Phase 2 (basic product CRUD in Phase 1)

- **FR-2.1 Product**: name, description, category (tree), brand, images, tax category, status (active/draft/archived), custom fields (key-value, Phase 5).
- **FR-2.2 Variants**: up to 3 options (e.g., size/color/material) generating variants; each variant: SKU, barcode (EAN/UPC/code128, multiple barcodes allowed), price, compare-at price, cost, per-location stock. Max 250 variants/product.
- **FR-2.3 Pricing**: base price per variant; per-location price overrides (Growth tier); scheduled price changes (Could).
- **FR-2.4 Modifiers** (Phase 4): option groups (min/max select, price deltas) attachable to products — café use case.
- **FR-2.5 Bundles** (Phase 4): composite products that decrement component stock.
- **FR-2.6 CSV import/export** with dry-run validation report; images via URL column.
  - _Phase 1 "basic import" subset (decided 2026-07-09):_ fixed-column template (name, category, price, sku, barcode, initial stock, tax category, option1–3 name/value for variants); create-only (no update-by-SKU); per-row validation report (row number + reason) — valid rows import, invalid rows are skipped and listed; no images, no dry-run mode. Full FR-2.6 (dry-run, image URLs, upsert) lands in Phase 2.

## FR-3 Inventory (US-13…18) — Phase 2

- **FR-3.1 Stock ledger**: every quantity change is an immutable `StockMovement` (type: sale, refund_restock, adjustment, receive, transfer_out/in, count) with actor, reason, timestamp. `InventoryLevel(variant × location)` is a materialized balance of the ledger.
- **FR-3.2 Adjustments** with reason codes (damaged, expired, theft, correction, other+note).
- **FR-3.3 Purchase orders**: draft → ordered → partially received → received/closed; supplier records; receiving updates stock + weighted-average cost.
- **FR-3.4 Transfers**: location A → B with in-transit state; discrepancy handling on receipt.
- **FR-3.5 Counts**: full or filtered (category/supplier) count sessions; scan-to-count UI; variance report; post adjustments in bulk.
- **FR-3.6 Reorder points** per variant × location; low-stock report + optional notification.
- **FR-3.7 Negative stock allowed** (sale never blocks) but visually flagged; report of negative-stock items.

## FR-4 Customers & loyalty (US-20…23) — Phase 2 (loyalty Phase 4)

- **FR-4.1 Customer**: name, phone (unique-per-store key for lookup), email, address, tags, notes, marketing consent, custom fields.
- **FR-4.2 History**: orders, totals, visit count, last visit, average basket.
- **FR-4.3 Loyalty (native)**: earn rate (points per currency unit), redeem as tender, per-tier multipliers (Could), balance adjustments with audit. Offline earn is safe; offline redeem capped (see sync doc).
- **FR-4.4 Store credit**: issued from refunds, spendable as tender (Phase 4).

## FR-5 Staff & permissions (US-24…26) — Phase 2

- **FR-5.1 Auth**: back office = email+password with 2FA (TOTP); register = 4–6 digit PIN per staff, auto-lock after inactivity.
  - _Phase 1 auto-lock default (decided 2026-07-10):_ POS locks to the PIN screen after **90 seconds** of inactivity; an in-progress cart is preserved and restored on unlock. Timeout becomes a per-store setting in Phase 2.
- **FR-5.2 Roles**: Owner, Manager, Cashier + custom roles. Permission flags include: max discount %, refunds, price override, void, no-sale drawer open, reports access, inventory ops, settings, catalog edit.
  - _Phase 1 fixed roles (decided 2026-07-09):_ **Owner** = all permissions. **Cashier** = sell, park/retrieve, custom sale, discounts up to **10%** (line or cart), open/close own shift, paid in/out. Refunds, voids, price overrides, tax-exempt sales, discounts above 10%, and no-sale drawer open require **Owner PIN escalation** at the register. Custom roles and the permission editor arrive with full FR-5.2 in Phase 2.
- **FR-5.3 Audit log**: voids, no-sales, overrides, refunds, permission changes, logins — queryable in admin.

## FR-6 Cash & shifts (US-27…29) — Phase 1 (reports deepen Phase 2)

- **FR-6.1 Shift**: open with float count → sales accumulate → paid in/out with reasons → close with blind count → over/short computed and stored. One active shift per register.
- **FR-6.2 Register report (Z)**: gross, net, tax collected, discounts, refunds, tender breakdown, transaction count, per-staff attribution.

## FR-7 Reports & dashboard (US-30…32) — Phase 2, advanced Phase 5

- **FR-7.1 Dashboard**: today vs yesterday/last week — revenue, transactions, avg basket, top 10 items, sales-by-hour chart; location filter.
- **FR-7.2 Reports**: sales by item/category/staff/register/location/tender/hour-of-day; margins (needs cost); taxes; discounts; refunds; inventory valuation; movement history. All: date range, filters, CSV export.
- **FR-7.3** No report paywall differences between paid tiers (pillar 5); free tier gets dashboard + daily summary only.

## FR-8 Multi-location (US-13, 16) — Phase 4

- **FR-8.1 Locations** with address, timezone, tax profile, receipt overrides. Registers belong to a location.
- **FR-8.2** Cross-location stock visibility from the register ("check other branches").
- **FR-8.3** Consolidated + comparative reporting across locations.

## FR-9 Payments integration — Phase 4

- **FR-9.1 Processor-agnostic**: adapter interface (`PaymentProvider`) with first implementations: Stripe Terminal, and manual/reference mode. Local acquirer adapters per launch market later.
- **FR-9.2** No surcharge or penalty for any processor choice.
- **FR-9.3** Card-present flow: create intent → terminal handshake → capture → attach transaction to order; idempotent retries; if processor unreachable, cashier can fall back to manual record (flagged).

## FR-10 Platform & API (US-33…35) — Phase 0 (settings), Phase 5 (API)

- **FR-10.1 Onboarding**: signup → store profile wizard → sample catalog offer → guided first sale. Target < 15 min.
- **FR-10.2 Settings**: store profile, locations/registers, taxes, tenders, receipt template editor (live preview), staff, subscription/billing.
- **FR-10.3 REST API v1** (`/api/v1`), API keys with scopes, rate limits; webhooks (order.created, order.refunded, inventory.updated, customer.created…) with HMAC signatures and retry/backoff.
- **FR-10.4 Multi-tenancy**: single logical DB, `store_id` on every row, enforced at ORM query layer; row-level security as defense in depth.

## Non-functional requirements

- **NFR-1 Offline**: POS clients fully operational ≥ 7 days offline; sync catch-up < 60 s for a day's transactions on 3G.
- **NFR-2 Performance**: add-to-cart < 100 ms local; product search < 150 ms over 50k SKUs locally; checkout tap-to-receipt < 2 s (excluding card network).
- **NFR-3 Scale targets (v1)**: 10k stores, 50 locations/store, 100k SKUs/store, 2M orders/store/yr.
- **NFR-4 Security**: OWASP ASVS L2; encrypted at rest (cloud + local DB); PCI scope minimized via processor tokenization (we never touch PANs).
- **NFR-5 Availability**: cloud API 99.9%; but POS sale capture availability = 100% by design (offline-first).
- **NFR-6 Auditability**: orders and stock movements immutable; corrections are new records.
- **NFR-7 i18n**: UI strings externalized from Phase 0; currency/number/date localized; receipt templates localizable. RTL not required v1.
- **NFR-8 Accessibility**: WCAG 2.1 AA for admin; POS optimized for touch (min 44px targets) and keyboard-only operation.
