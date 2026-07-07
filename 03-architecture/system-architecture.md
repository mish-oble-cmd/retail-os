# System Architecture

## Overview

Channel-agnostic core commerce platform (the Shopify lesson) with offline-first POS clients (our differentiator).

```
                    ┌─────────────────────────────────────────┐
                    │              CLIENTS                     │
                    │                                          │
   ┌───────────┐    │  ┌────────────┐  ┌─────────────────┐    │
   │ Web Admin │    │  │ Desktop POS │  │   Mobile POS    │    │
   │ (Next.js) │    │  │ (Electron)  │  │ (React Native)  │    │
   └─────┬─────┘    │  └──────┬──────┘  └────────┬────────┘    │
         │          │         │  local SQLite    │ local SQLite │
         │          │         └────────┬─────────┘              │
         │          │             @retailos/sync                │
         └──────────┼──────────────────┼────────────────────────┘
                    │                  │
              HTTPS REST          Sync protocol (HTTPS, batched)
                    │                  │
        ┌───────────▼──────────────────▼───────────────┐
        │        API GATEWAY (NestJS, modular monolith) │
        │                                               │
        │  Modules:                                     │
        │   identity │ catalog │ inventory │ orders     │
        │   customers│ loyalty │ payments  │ reports    │
        │   sync     │ webhooks│ billing   │ settings   │
        └───────┬───────────┬───────────┬───────────────┘
                │           │           │
         ┌──────▼───┐  ┌────▼────┐ ┌────▼─────────┐
         │PostgreSQL│  │  Redis  │ │ Object store │
         │ (primary)│  │cache/jobs│ │ (images, S3) │
         └──────────┘  └─────────┘ └──────────────┘
                │
         ┌──────▼──────────────┐
         │ Background workers   │  (BullMQ: webhooks, emails,
         │                      │   report aggregation, imports)
         └─────────────────────┘
```

## Key decisions (ADR summary)

### AD-1: Modular monolith backend

One NestJS deployable with strictly bounded modules (no cross-module DB table access; communicate via module services/events). Shopify scaled a monolith to $200B+ GMV; a small team should not pay microservice tax. Extraction path exists per-module if ever needed.

### AD-2: Shared domain package — logic runs on client AND server

`@retailos/domain` (pure TypeScript, zero I/O deps) contains: cart math, tax calculation, discount/promotion engine, loyalty accrual rules, money utils. POS clients execute it locally (offline correctness), server executes the same code for validation/recompute on sync. **One implementation, two runtimes — this is the linchpin of offline-first.**

### AD-3: POS clients are local-first apps

Desktop and mobile POS read/write a local SQLite database. The UI never awaits the network. A sync engine (`@retailos/sync`) replicates: catalog/settings/customers _down_, orders/shifts/movements/customer-edits _up_. Web admin is online-only (back office can require connectivity; the register cannot).

### AD-4: Event-shaped writes for sale data

POS produces immutable facts (`Order`, `Payment`, `StockMovement`, `ShiftEvent`) with client-generated ULIDs + idempotency keys. Server ingest is append + validate + project. Conflicts are reconciled by domain rules, not last-write-wins (see `offline-sync-strategy.md`).

### AD-5: One React POS codebase for web/desktop; RN shares domain+sync only

Desktop POS = Electron shell around the same React app (`apps/pos-web`), giving us browser POS for free. Mobile POS is React Native reusing `domain`, `sync`, `api-client`, and design tokens — but its own UI (touch ergonomics differ too much to force a shared UI layer).

### AD-6: PostgreSQL single database, tenant-scoped

`store_id` column everywhere + ORM-level tenant guard + Postgres RLS as backstop. Shard only when data proves the need (Shopify's pod model is the eventual blueprint).

## Module responsibilities (server)

| Module    | Owns                                                         | Emits events                         |
| --------- | ------------------------------------------------------------ | ------------------------------------ |
| identity  | stores, staff, roles, auth, API keys                         | staff.updated                        |
| catalog   | products, variants, categories, modifiers, price lists       | catalog.changed (drives client sync) |
| inventory | levels, movements, POs, transfers, counts, suppliers         | inventory.updated                    |
| orders    | orders, line items, payments records, refunds, shifts        | order.created/refunded               |
| customers | customers, tags, consent                                     | customer.created/updated             |
| loyalty   | balances, accrual/redemption rules                           | loyalty.adjusted                     |
| payments  | provider adapters, terminal sessions                         | payment.captured/failed              |
| sync      | client registration, batch ingest, delta feeds, conflict log | —                                    |
| reports   | read models/aggregates (daily rollups)                       | —                                    |
| webhooks  | subscriptions, delivery, retries, HMAC                       | —                                    |
| billing   | plans, subscription state (Stripe Billing)                   | subscription.changed                 |
| settings  | taxes, tenders, receipt templates, locations, registers      | settings.changed                     |

## Data flow: a sale (happy path, offline)

1. Cashier builds cart → `@retailos/domain` computes totals/tax/discounts locally
2. Payment recorded → order + payment + stock movements + shift event written to local SQLite in one transaction, receipt prints — **sale complete, zero network**
3. Sync engine queues the batch; when online, POSTs `/sync/batches` with idempotency key
4. Server validates (recomputes totals via same domain code), persists, projects inventory levels, fires webhooks
5. Divergences (price changed mid-offline, negative stock) → recorded in conflict log per resolution rules, surfaced in admin "Sync Health" screen

## Cross-cutting

- **IDs**: ULIDs generated client-side (sortable, offline-safe, no coordination)
- **Money**: integer minor units + currency code; `Money` type in domain package
- **Events**: in-process event bus now; outbox table → worker for webhooks (at-least-once, HMAC-signed)
- **Observability**: OpenTelemetry traces, structured logs (pino), Sentry on all clients; sync metrics are first-class (lag, pending batches, conflict rate)
- **API versioning**: URL-versioned `/api/v1`; sync protocol has its own version handshake
