# Phase 5 — Platform & v1.0 Launch

**Goal:** open the platform (API, webhooks, integrations), finish advanced reporting, and polish to a public v1.0. Shopify lesson S4/S8: the ecosystem starts with great APIs and docs, not a marketplace.

**FRs:** FR-10.3, FR-7.2 (advanced), FR-2.3 (scheduled prices), custom fields (FR-2.1/4.1), remaining Could items triaged.

## Workstreams

### 5A Public API GA

Freeze v1 OpenAPI; ADM-20 (API keys w/ scopes, webhook subscriptions, delivery log + replay); rate limiting per key; public docs site generated from OpenAPI (with guides: "sync products from your ERP", "push orders to accounting"); sandbox store mode; changelog + deprecation policy published.

### 5B Integrations (prove the API)

Two reference integrations built ON the public API (dogfood): QuickBooks/Xero daily journal export, and a generic Google Sheets/CSV scheduled export. Zapier/Make listing if feasible.

### 5C Advanced reporting

Custom date comparisons, cohort-lite (new vs returning customers), sell-through rate, stock cover days, staff scorecards, scheduled email reports. Still no paywall between paid tiers.

### 5D Polish & launch hardening

Admin dark mode; perf pass against NFR-2 budgets (measure, fix, document); accessibility audit (WCAG AA) on admin; onboarding funnel instrumentation + fixes; empty states everywhere; error-message copy pass; status page; support docs/knowledge base seeded (top 30 articles); backup/restore drill; load test to NFR-3 targets; full `security-review` + external pentest if budget allows.

### 5E Launch ops

Pricing page + self-serve upgrade flows final; demo store with seeded data; 5 pilot merchants completing 2 full weeks live; incident runbook; on-call basics.

## Acceptance criteria

- [ ] Third-party dev (not the author) builds a working integration from docs alone, no support pings
- [ ] Webhooks: 100k-delivery soak test, ≥99.9% delivered ≤ 5 min, dedupe-safe
- [ ] QuickBooks/Xero export reconciles to the cent against Z-reports for a pilot week
- [ ] NFR-2 perf budgets met on reference hardware (mid-range Android tablet, 2019 i5 desktop)
- [ ] 5 pilot merchants live 2 weeks; NPS collected; zero data-loss incidents
- [ ] v1.0 tagged; changelog; marketing claims audited against reality (esp. offline claims)

## Post-v1 backlog (parking lot — do NOT pull forward)

E-commerce channel integration (Shopify/Woo sync!), app marketplace, native payments take-rate, B2B/wholesale, appointments/services vertical, kitchen display system, self-checkout kiosk mode, AI insights ("Sidekick for SMB retail"), regional compliance profiles beyond launch market.
