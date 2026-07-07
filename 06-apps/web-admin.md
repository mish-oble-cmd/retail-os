# App Spec — Web Admin (`apps/admin`)

The back office: catalog, inventory, customers, staff, reports, settings. Online-only (unlike POS). Next.js App Router.

## Users & context
Maria (owner, often on phone browser) and Grace (manager, desktop). Must be responsive down to 390px for the "check today's sales from my phone" job (US-30) even though data-heavy screens optimize for desktop.

## Information architecture (sidebar)

```
Dashboard
Orders
Products        › All products · Categories · Promotions
Inventory       › Levels · Purchase orders · Transfers · Counts · Suppliers
Customers
Reports
Staff
Settings        › Store · Locations & registers · Taxes · Tenders ·
                  Receipts · Billing · Sync health · API & webhooks
```

## Implementation notes

- **Rendering**: server components for lists/reports (fast, cacheable); client components for editors; TanStack Query for mutations/optimistic updates
- **Tables**: `DataTable` from `@retailos/ui` — column presets per screen, URL-synced filters (shareable report links), footer totals for money columns
- **Forms**: zod schemas shared with API validation; dirty-state guard on navigation
- **Charts**: one wrapped chart lib (e.g., Recharts) behind `@retailos/ui` chart components only
- **Search omnibox** (⌘K): products, orders (by number), customers — from Phase 2
- **Density**: `density="admin"`; respect reduced motion
- **Empty states everywhere** with a CTA (onboarding is a feature — S1)
- **Money**: only via `MoneyText`; never hand-formatted

## Screen specs
See `04-design/screen-inventory.md` ADM-01…20 for per-screen elements and phases. The approved mockup is the contract.

## Route ↔ permission map (enforced server-side too)
Reports → `reports.view`; Staff → `staff.manage`; Settings/* → `settings.manage`; refund from admin → `orders.refund`. Unauthorized → explain-and-request pattern, not a bare 403.

## Performance budgets
Dashboard TTFB < 500ms (cached rollups); product list 50 rows < 1s on 3G Fast; bundle: no route > 300KB gz.
