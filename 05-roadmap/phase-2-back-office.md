# Phase 2 — Back Office Depth

**Goal:** the admin becomes a real retail back office — inventory operations, customers, staff roles, promotions, and the reports Shopify paywalls (our differentiator #2).

**FRs:** FR-2.2 (full variants), FR-2.6 (CSV full), FR-3.2–3.7, FR-4.1–4.2, FR-5.2–5.3, FR-7.1–7.2, FR-1.2 (discount codes/automatic promotions), exchanges (FR-1.8 full).

## Mockup gate

ADM-02 (already approved — implement now), 06, 07, 09, 10, 12, 13, 14, 15 · POS-09, 11.

## Workstreams

### 2A Inventory operations

Stock ledger UI (movement history per variant), reasoned adjustments, suppliers, purchase orders (draft→receive partial→cost update via weighted average), stock counts (scan-to-count + variance post), reorder points + low-stock report, negative-stock report.

### 2B Customers

Customer CRUD admin + POS attach/create (phone-first); history, tags, notes, consent; POS purchase-history peek. CSV import/export.

### 2C Staff, roles & audit

Custom roles with permission flags incl. `max_discount_pct`; POS enforces (manager PIN escalation sheet); audit log (voids, no-sales, overrides, refunds, logins) + admin viewer.

### 2D Promotions

Rules engine in `@retailos/domain` (evaluated identically offline): automatic promotions (%/fixed/BOGO, scope, schedule) + discount codes; itemized on receipts; stacking rules documented in domain tests.

### 2E Reports & dashboard

Dashboard (ADM-02) live; reports hub: sales by item/category/staff/register/hour/tender, margins, taxes, discounts, refunds, inventory valuation & movements. Daily rollup job (worker) + CSV export. Daily summary email.

### 2F Exchanges

Refund+new-sale linked flow at POS with net settlement.

## Acceptance criteria

- [ ] Raise PO for 3 suppliers' items, receive partially twice, costs reflect weighted average
- [ ] Count session on one category via scanning, variance posted, ledger shows `count` movements
- [ ] Cashier blocked at >10% discount; manager PIN unlocks; audit log records both
- [ ] Automatic "Buy 2 get 1" promo applies correctly offline
- [ ] Customer attached at POS shows history; repeat purchase updates stats
- [ ] Exchange: return shirt, take larger size, pay difference — one linked record set
- [ ] Every report renders with real data and exports CSV; margins match hand-computed check
- [ ] Dashboard matches Z-reports for the same day (reconciliation!)

## Out of scope

Loyalty (P4), transfers/multi-location (P4), mobile (P3), API (P5).
