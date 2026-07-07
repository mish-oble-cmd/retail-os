# Phase 4 — Payments, Hardware & Multi-Location

**Goal:** integrated card payments (processor-agnostic), the "batteries included" retail features (loyalty, store credit, modifiers, bundles), and true multi-branch operation.

**FRs:** FR-9.1–9.3, FR-4.3–4.4, FR-2.4–2.5, FR-3.4 (transfers full), FR-8.1–8.3, gift receipts, BOPIS-lite (optional stretch).

## Mockup gate
ADM-08 · POS additions: terminal payment states, loyalty redeem sheet, modifier picker, other-branch stock view · loyalty admin in ADM-12.

## Workstreams

### 4A Payments adapter layer
`PaymentProvider` interface (create_intent, process, capture, refund, cancel + terminal pairing). Implementations: **Stripe Terminal** (first), manual mode (existing) refactored under the interface. Card-present flow with idempotent retries; offline fallback = manual record flagged `processor_unreachable`. Refund-to-card flow. PCI SAQ-A checklist per security doc.

### 4B Loyalty & store credit
Native loyalty: earn rate config, POS redeem-as-tender with offline cap rule, balance admin + audit. Store credit issued from refunds, spendable tender, expiry policy option.

### 4C Modifiers & bundles
Modifier groups (min/max, price deltas) with POS picker sheet (café flow: latte + oat milk + extra shot); bundles decrementing component stock; both correct offline (domain package).

### 4D Multi-location
Location CRUD unlimited (plan-gated), per-location tax profiles & receipt overrides; transfers with in-transit + discrepancy receive; POS "check other branches" stock view; comparative reports (sales by location, consolidated dashboard); per-location price overrides (Growth tier).

### 4E Hardware certification round
Certify list: 2 Epson + 2 XPrinter models, cash drawer kick via printer, 2 barcode scanner models, Stripe reader models per market. Publish `06-apps/hardware-compatibility.md` results table.

## Acceptance criteria
- [ ] Tap card on Stripe reader → paid order; unplug internet mid-payment → graceful fallback path recorded correctly
- [ ] Refund to original card from admin and from POS
- [ ] Customer earns points on sale, redeems on next sale offline (within cap); reconciliation correct after sync
- [ ] Refund issues store credit; credit spent across split tender
- [ ] Latte with 3 modifiers prices correctly offline; bundle sale decrements components
- [ ] Transfer 20 SKUs branch A→B with one discrepancy; both ledgers correct
- [ ] Cashier sees branch B stock for an item out of stock at branch A
- [ ] Consolidated dashboard = sum of per-location dashboards
- [ ] PCI SAQ-A checklist complete

## Out of scope
Public API/webhooks UI (P5), additional processor adapters (post-v1, adapter interface proves the seam), full BOPIS (stretch → P5 if slipping).
