# Personas & User Stories

## Personas

### P1 — Maria, owner-operator (primary)

Runs a two-branch boutique/minimart. Does everything: buying, selling, books. Phone-first, non-technical, price-sensitive. Internet drops several times a week.
**Needs:** see today's sales from her phone, trust the stock numbers, stop staff "shrinkage", never lose a sale to a dead connection.

### P2 — Ken, cashier

19, part-time, minimal training time. Uses the register 6 hours/day on a tablet.
**Needs:** fast product lookup, barcode scan, obvious buttons, impossible-to-mess-up payment flow, shift open/close that tells him exactly what to count.

### P3 — Grace, store manager (multi-location)

Manages 4 branches for a small chain. Lives in the back office.
**Needs:** purchase orders, transfers, stock counts, staff performance, per-branch P&L-ish reports, price updates that hit every register instantly (or on next sync).

### P4 — Dev, integrator (phase 5)

Freelance dev connecting RetailOS to accounting/e-commerce.
**Needs:** clean REST API, webhooks, API keys, sandbox, good docs.

## Epic → user story map

Stories are numbered `US-xx` and referenced by the PRD and phase plans. Priority: **M**ust / **S**hould / **C**ould (per MVP).

### Epic A — Sell (register)

- US-01 (M) As Ken, I ring up items by barcode scan, search, or tapping a product grid so checkout takes seconds.
- US-02 (M) As Ken, I adjust quantities, remove lines, and add a line-item or cart discount (within my permission limit).
- US-03 (M) As Ken, I take cash payment and the app tells me the change.
- US-04 (M) As Ken, I take card payment (recorded manually in MVP; integrated terminal phase 4) and can split tenders.
- US-05 (M) As Ken, I print or email a receipt automatically after payment.
- US-06 (M) As Ken, I park a cart and retrieve it later (customer forgot wallet).
- US-07 (M) As Ken, I sell a custom item (type name + price) for uncatalogued goods.
- US-08 (M) As Ken, I process a refund/return against an order (manager PIN if over limit).
- US-09 (S) As Ken, I apply a promo code or automatic promotion and see it itemized.
- US-10 (M) As Ken, **everything above works with the internet down**, and syncs when it returns.

### Epic B — Catalog & inventory

- US-11 (M) As Maria, I create products with variants (size/color), price, cost, SKU, barcode, image.
- US-12 (M) As Maria, I import/export products via CSV.
- US-13 (M) As Grace, stock is tracked per location and every sale/refund adjusts it automatically.
- US-14 (M) As Grace, I adjust stock with a reason (damage, count, received) and see an audit trail.
- US-15 (S) As Grace, I create purchase orders, receive them (partially), and costs update.
- US-16 (S) As Grace, I transfer stock between locations with in-transit state.
- US-17 (S) As Grace, I run cycle counts with a scan-based counting screen and post discrepancies.
- US-18 (S) As Grace, I get low-stock alerts based on reorder points.
- US-19 (C) As Maria, I define modifiers (e.g., "extra shot") and bundles.

### Epic C — Customers & loyalty

- US-20 (M) As Ken, I attach a customer (search/create) to a sale.
- US-21 (M) As Maria, I see a customer's purchase history, notes, and tags.
- US-22 (S) As Maria, customers earn points per purchase and redeem them at the register (native loyalty).
- US-23 (C) As Maria, I export a customer list with marketing consent flags.

### Epic D — Staff & security

- US-24 (M) As Maria, staff log into the register with a PIN; every sale is attributed.
- US-25 (M) As Maria, roles limit actions: discounts over X%, refunds, price edits, report access, drawer opens.
- US-26 (S) As Maria, I see an audit log of sensitive actions (voids, no-sales, price overrides).

### Epic E — Cash & shift management

- US-27 (M) As Ken, I open a shift with a counted float and close with a blind count; the system reports over/short.
- US-28 (M) As Ken, I record paid-in/paid-out with reasons.
- US-29 (M) As Grace, I see an end-of-day (Z) summary per register: tenders, taxes, discounts, refunds.

### Epic F — Reports & insights

- US-30 (M) As Maria, I see a live dashboard: today's sales, transactions, average basket, top items — per location.
- US-31 (S) As Grace, I run reports: sales by item/category/staff/hour/location/tender, margins, taxes — filter + CSV export.
- US-32 (C) As Maria, I get a daily sales summary by email/notification.

### Epic G — Settings & platform

- US-33 (M) As Maria, I configure store profile, locations, registers, tax rates (inclusive & exclusive), receipt template, currency.
- US-34 (M) As Maria, onboarding gets me from signup to first sale in under 15 minutes (sample data + guided steps).
- US-35 (S) As Dev, I create API keys and subscribe to webhooks (orders, inventory, customers).
