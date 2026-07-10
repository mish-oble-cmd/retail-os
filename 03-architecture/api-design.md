# API Design

REST, OpenAPI-first (spec is written before handlers; `@retailos/api-client` is generated from it). Base path `/api/v1`. Public API ships in Phase 5, but internal clients use the same API from Phase 1 — we are our own first API customer (Shopify lesson S8).

## Conventions

- JSON; snake_case fields; money as `{ "amount": 12900, "currency": "PHP" }`
- ULIDs; timestamps UTC ISO-8601
- Pagination: cursor-based (`?limit=50&cursor=...` → `next_cursor`)
- Filtering: documented per-resource query params (no generic query language in v1)
- Errors: RFC 9457 problem+json → `{ "type", "title", "status", "detail", "errors": [{field, code, message}] }`
- Idempotency: `Idempotency-Key` header honored on all POSTs that create money/stock facts
- Rate limits: token bucket per API key; headers `X-RateLimit-Remaining`, `Retry-After`
- Versioning: breaking changes → `/api/v2`; additive changes are non-breaking by contract (clients must ignore unknown fields)

## Auth

| Client              | Mechanism                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Admin web           | Session cookie (httpOnly) from email+password+TOTP                                                                                    |
| POS devices         | Device token (from activation) + staff PIN context header `X-Staff-Id` (server logs attribution; authorization enforced against role) |
| Public API          | `Authorization: Bearer rok_...` API keys with scopes (`read_orders`, `write_products`, …)                                             |
| Webhooks (outbound) | `X-RetailOS-Signature: hmac-sha256=...` over raw body, per-subscription secret                                                        |

## Resource map (v1)

```
/stores/current                          GET, PATCH
/locations, /locations/{id}              CRUD
/registers, /registers/{id}              CRUD  (+ POST /registers/{id}/activation-codes)
/staff, /roles                           CRUD
/products, /products/{id}                CRUD  (+ /products/import CSV, /products/export)
/variants/{id}                           GET, PATCH
/categories                              CRUD
/promotions, /discount-codes             CRUD
/inventory/levels                        GET (filter variant/location)
/inventory/adjustments                   POST (reasoned adjustment)
/purchase-orders (+ /receive)            CRUD + action
/transfers (+ /dispatch, /receive)       CRUD + actions
/count-sessions (+ /post)                CRUD + action
/customers, /customers/{id}              CRUD (+ /customers/{id}/orders)
/loyalty/accounts/{customer_id}          GET (+ POST /adjustments)
/orders                                  GET list, GET {id}, POST (API-source orders)
/orders/{id}/refunds                     POST
/shifts                                  GET (+ POST open/close via POS-scoped endpoints)
/reports/{report}                        GET (sales_by_item, sales_by_staff, tenders, taxes, inventory_valuation, …)
/webhooks/subscriptions                  CRUD (+ test delivery)
/api-keys                                CRUD (admin session only)

/sync/activate                           POST (activation code → device token; the only unauthenticated sync route)
/sync/bootstrap                          GET  (device token; snapshot)
/sync/changes?since=rev                  GET  (delta feed)
/sync/batches                            POST (fact ingest; see offline-sync-strategy.md)
```

## Representative payloads

### POST /sync/batches (POS → server)

```json
{
  "batch_id": "01J8ZQ3F9K7...",
  "client": { "register_id": "01J8...", "app_version": "1.4.2", "schema_rev": 12 },
  "facts": [
    {
      "type": "order.completed",
      "order": {
        "id": "01J8ZQ4A...",
        "number": "R2-000481",
        "staff_id": "01J8...",
        "customer_id": null,
        "lines": [
          {
            "id": "01J8...",
            "variant_id": "01J8...",
            "name": "T-Shirt / M / Black",
            "qty": 2,
            "unit_price": { "amount": 49900, "currency": "PHP" },
            "discounts": [],
            "tax_lines": [{ "rate_id": "vat12", "amount": 10693 }]
          }
        ],
        "totals": { "subtotal": 99800, "discount": 0, "tax": 10693, "total": 99800 },
        "payments": [{ "id": "01J8...", "tender": "cash", "amount": 100000, "change": 200 }],
        "client_created_at": "2026-07-08T03:21:44Z",
        "local_seq": 481
      }
    },
    {
      "type": "stock.movement",
      "movement": {
        "id": "01J8...",
        "variant_id": "01J8...",
        "location_id": "01J8...",
        "qty_delta": -2,
        "movement_type": "sale",
        "ref_order_id": "01J8ZQ4A..."
      }
    }
  ]
}
```

Response: per-fact ack `{ id, status: "accepted" | "duplicate" | "accepted_with_conflict", conflict?: {...} }`.

### Webhook delivery

```json
{
  "id": "01J8...",
  "topic": "order.created",
  "store_id": "01J8...",
  "occurred_at": "2026-07-08T03:21:50Z",
  "api_version": "v1",
  "data": { "order": {/* full order resource */} }
}
```

Delivery: POST, 10s timeout, retries 8× exponential (≈ 24h), auto-disable subscription after sustained failure + email alert. Consumers must dedupe by `id`.

## Internal-only endpoints

POS/admin-specific endpoints (shift open/close, register layout save) live under the same API with device/session auth but are marked `x-internal: true` in OpenAPI and excluded from public docs until stabilized.

## Deliverables checklist (Phase 1 onward)

- [ ] `openapi.yaml` committed at `apps/api/openapi/v1.yaml`, CI-validated, drives generated client
- [ ] Idempotency middleware + tests (duplicate POST returns original result)
- [ ] Problem+json error filter
- [ ] Cursor pagination helper
- [ ] Rate limiter (per key / per device)
