# Shopify Platform Architecture Study

How Shopify is structured technically and organizationally — and which patterns we borrow.

## 1. High-level structure

```
┌──────────────────────────────────────────────────────────────┐
│                        Merchant Admin (web + mobile app)       │
├──────────────────────────────────────────────────────────────┤
│  Online Store   │  POS (iOS/Android) │ Sales Channels (FB,    │
│  (themes/Liquid,│  + card readers    │ Google, marketplaces)  │
│  Hydrogen)      │                    │                        │
├──────────────────────────────────────────────────────────────┤
│                    CORE COMMERCE PLATFORM                      │
│  Products · Inventory · Orders · Customers · Discounts ·      │
│  Checkout · Payments · Fulfillment · Analytics · Staff        │
├──────────────────────────────────────────────────────────────┤
│  APIs: Admin GraphQL/REST · Storefront API · Webhooks         │
│  Extensibility: Apps · Shopify Functions · Flow (automation)  │
└──────────────────────────────────────────────────────────────┘
```

**Key insight:** Shopify is _channel-agnostic core commerce_. POS, web store, and marketplaces are all just **sales channels** writing to the same product/inventory/order/customer objects. This is the single most important architectural idea to copy.

## 2. Technical facts worth knowing

- **Majestic modular monolith**: Rails monolith organized into components with enforced boundaries (their `packwerk` tool) rather than microservices. They deliberately avoided microservice sprawl. Selected hot paths (storefront rendering, payments) were extracted.
- **Multi-tenancy via "pods"**: shops are sharded into isolated pods (DB + workers), enabling horizontal scale and blast-radius isolation. Every row is scoped by `shop_id`.
- **MySQL + Vitess** for sharding; heavy use of Redis, Kafka, and background jobs.
- **GraphQL-first APIs** (REST admin API is now legacy); rate limiting by calculated query cost.
- **Webhooks** as the integration backbone for the app ecosystem.
- **Checkout as sacred path**: extremely hardened, versioned, extensibility only through sandboxed "Functions" (WebAssembly), never arbitrary code injection.
- **POS apps are React Native**, talking to the same core APIs, with a local database for offline resilience (offline support is limited — a known weakness, see strengths/weaknesses doc).
- **Idempotency keys** on all mutation-critical endpoints (orders, payments).

## 3. Core domain objects (Shopify's data model, simplified)

| Object                                                 | Notes                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| Shop                                                   | Tenant root; everything hangs off it                                       |
| Product → Variant                                      | Variants carry SKU, barcode, price; options (size/color) generate variants |
| InventoryItem + InventoryLevel                         | Quantity is per (item × location) — enables multi-location                 |
| Location                                               | Physical/virtual stock location; POS registers bind to one                 |
| Customer                                               | Unified across channels; the omnichannel glue                              |
| Order → LineItems, Transactions, Fulfillments, Refunds | Orders are append-only-ish; edits create adjustment records                |
| Discount / PriceRule                                   | Codes + automatic discounts                                                |
| StaffMember + roles/PINs (POS)                         | Per-location permissions                                                   |
| Session/Cart (POS)                                     | Ephemeral until converted to Order                                         |

## 4. Organizational lessons

- Small "mission" teams own vertical slices (e.g., "POS inventory") end to end
- Strong platform/infra teams support product teams
- Design system ("Polaris") is public and mandatory → consistent UI at scale, and third-party apps look native

## 5. Patterns we adopt for RetailOS

1. **Modular monolith** backend, not microservices — right for a small team; enforce module boundaries in-code
2. **Channel-agnostic core**: POS is a client of the same domain API a future web store would use
3. **Inventory = item × location** from day one
4. **Orders append-only** with adjustment/refund records, never destructive edits
5. **Idempotency keys** on order/payment creation (critical for offline sync replays)
6. **Tenant scoping (`store_id`) on every row**, single shared DB until scale demands sharding
7. **Design system first** (our "Polaris" = `@retailos/ui`)
8. **Webhooks + versioned REST API** for extensibility (GraphQL optional later)
