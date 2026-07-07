# RetailOS — Vision & Strategy

## Vision

**The point of sale that never stops selling.** A commerce platform for small and mid-size retailers that works flawlessly offline, costs a fraction of Shopify's real-world price, and includes the features merchants otherwise pay five apps for.

## Mission statement

Give any retailer — from a single market stall to a 20-branch chain — enterprise-grade selling, inventory, and insight tools that run on the hardware they already own and the internet they actually have.

## Product pillars (every decision tests against these)

1. **Offline-first.** The register never blocks on the network. Period.
2. **One core, many channels.** Products, inventory, orders, customers live in one domain; POS desktop/mobile/web are clients of it.
3. **Batteries included.** Loyalty, reports, modifiers, bundles are native, not upsells.
4. **Runs on anything.** Browser, Windows/macOS desktop, Android/iOS tablets and phones, generic ESC/POS hardware.
5. **Honest pricing.** No processor penalties, no report paywalls, free tier that's actually usable.

## Target customers (priority order)

1. **Single-location specialty retail** (fashion, convenience, pharmacy, hardware, pet, minimart) — 1–10 staff
2. **Small chains** (2–10 locations) outgrowing Loyverse/spreadsheets but priced out of Lightspeed
3. **Cafés / quick-service** (phase 4+, via modifiers + open tabs)

Primary launch geography: markets with expensive/unreliable connectivity and cash-heavy retail (SE Asia first), where Shopify POS is weakest. The product must still feel first-class to a US/EU boutique.

## Business model

| Tier | Price (indicative) | Includes |
|---|---|---|
| **Free** | $0 | 1 location, 1 register, 2 staff, full selling + basic reports, community support |
| **Standard** | ~$29/mo/location | Unlimited registers, staff roles/PINs, full inventory ops (PO, counts, transfers), all reports, loyalty |
| **Growth** | ~$69/mo/location | Multi-location transfers/analytics, API + webhooks, priority support, advanced promotions |
| Long-term | Payments take rate | Integrated payments (Stripe/Adyen/local acquirers) once volume justifies — Shopify's real lesson |

Revenue philosophy: subscriptions fund the business now; payments become the flywheel later. Never penalize external processors (differentiator vs Shopify).

## Success metrics

- **Time-to-first-sale** < 15 minutes from signup (Shopify lesson S1)
- Register uptime independent of network: 100% of sales capturable offline
- Sync reconciliation error rate < 0.01% of transactions
- Free→paid conversion ≥ 5%; logo churn < 2%/mo

## Scope boundaries (v1 era, phases 0–5)

**In:** POS (desktop, mobile, web), back-office admin (web), inventory, customers, loyalty, promotions, reports, cash management, receipts, multi-location, staff/permissions, REST API + webhooks, processor-agnostic card payments.

**Out (deliberately):** online storefront builder, app marketplace, native payment processing, B2B contracts, warehouse management, accounting (integrate with QuickBooks/Xero instead), e-commerce channel sync (integration later).

## Naming

Working codename **RetailOS**. All code uses `@retailos/*` package scope; a global rename is a find-replace when branding lands.
