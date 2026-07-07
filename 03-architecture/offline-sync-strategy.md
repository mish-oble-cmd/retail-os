# Offline-First Sync Strategy

The core differentiator (attacks Shopify weaknesses W1/W5). Read alongside `data-model.md` and AD-2/AD-3/AD-4 in `system-architecture.md`.

## Principles

1. **Local is the source of truth for the sale.** The register writes to SQLite and completes the sale; the cloud learns about it later.
2. **Facts flow up, reference data flows down.** No entity is edited on both sides except Customer (handled specially).
3. **Same math everywhere.** `@retailos/domain` computes carts on client and revalidates on server — divergence is detectable, not silent.
4. **At-least-once + idempotent = effectively exactly-once.** ULIDs + idempotency keys make replays harmless.

## What syncs which way

| Data                                                                                | Direction             | Notes                                                          |
| ----------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| Catalog, prices, promotions, taxes, tenders, staff/roles, settings, register layout | ⬇ down                | Delta feed by `sync_rev`                                       |
| Inventory levels                                                                    | ⬇ down (display only) | Client shows last-known; never blocks a sale                   |
| Customers                                                                           | ⬇⬆ both               | Field-level merge, server wins on conflict except notes append |
| Orders, payments, refunds, stock movements, shifts, loyalty earn                    | ⬆ up                  | Immutable facts, batched                                       |
| Loyalty redemption                                                                  | ⬆ up with cap         | See conflict rules #4                                          |

## Client anatomy (`@retailos/sync`)

- **Outbox table**: every locally-created fact row also appends an outbox entry (same SQLite transaction — atomicity guarantees no lost sales)
- **Pusher**: drains outbox in order into `POST /sync/batches` (≤500 facts/batch, gzip, batch idempotency key = ULID). Retries with exponential backoff + jitter; survives app restarts (cursor persisted)
- **Puller**: `GET /sync/changes?since=<last_ack_rev>` long-poll/interval; applies deltas in a transaction; bumps `last_ack_rev` only after apply
- **Bootstrap**: first activation downloads a snapshot (catalog+settings+customers) then switches to deltas
- **Status surface**: every POS screen shows a subtle sync indicator (synced / N pending / offline); "Sync Health" detail screen for troubleshooting

## Server ingest pipeline

```
POST /sync/batches
  → dedupe by (store_id, batch idempotency_key)          [replay-safe]
  → per fact: dedupe by entity ULID                       [replay-safe]
  → revalidate: recompute order totals via domain package
  → persist facts, project InventoryLevel, LoyaltyAccount
  → divergences → SyncConflict rows (never reject the sale)
  → emit webhooks/events
  → respond with acks + current server revs
```

**Golden rule: a completed sale is NEVER rejected.** Money changed hands in the physical world; the system's job is to record reality and flag discrepancies for humans.

## Conflict resolution rules

| #   | Scenario                                                            | Resolution                                                                                                                                                                       |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Price changed while register offline; sale used stale price         | Accept sale at charged price (it's reality). Log conflict `stale_price` with delta for the admin report                                                                          |
| 2   | Two registers sell the last unit → negative stock                   | Allow (FR-3.7). Level goes negative; flagged in low-stock/negative report                                                                                                        |
| 3   | Same customer edited on two devices                                 | Field-level merge by latest timestamp; `note` fields append-merge; conflict logged                                                                                               |
| 4   | Loyalty points redeemed offline beyond live balance                 | Offline redemption capped at (last-synced balance − configurable safety margin, default 20%). Overshoot on reconcile → balance floors at 0 + conflict logged                     |
| 5   | Staff member deactivated while device offline                       | Sales made before delta applied stay valid + audit-flagged; device locks that PIN on delta apply                                                                                 |
| 6   | Order number collision                                              | Impossible by construction: number = `<register prefix>-<local sequence>`; global uniqueness via ULID; display number is per-register                                            |
| 7   | Refund created offline against an order that was refunded elsewhere | Second refund exceeding refundable amount → recorded as `over_refund` conflict, surfaced to manager for cash-drawer correction; not silently dropped                             |
| 8   | Clock skew                                                          | Client sends `client_created_at` + monotonic sequence; server stamps `received_at`; ordering within a register uses the local sequence, cross-register ordering uses server time |

## Offline duration & storage budget

- Target: **≥ 7 days fully offline** (NFR-1). SQLite footprint at 50k SKUs + 10k customers + a week of sales ≈ well under 1 GB — comfortable
- Catalog staleness banner after 24h offline ("Prices last updated …")
- If the device is offline > 30 days, require re-bootstrap before selling (staleness risk exceeds usefulness)

## Register activation & trust

- Admin generates a one-time activation code per register → device exchanges it for a device token (scoped to store + register, revocable in admin)
- Local SQLite encrypted (SQLCipher/OS keystore); device token never leaves keychain
- Staff PINs verified against synced `pin_hash` locally (argon2id, cost tuned for tablets)

## Browser POS caveat

`pos-web` in a plain browser uses wa-sqlite/OPFS where available; where storage is unreliable, browser mode declares itself **online-preferred** (still queues briefly via IndexedDB but warns it's not certified for extended offline). Certified offline = desktop (Electron) and mobile (RN). Marketing must reflect this honestly.

## Testing this (see testing-strategy.md)

- Deterministic sync simulator: scripted multi-register scenarios (sell/refund/edit offline, reconnect in every order) asserting final server state
- Chaos suite: kill process mid-transaction, duplicate batch delivery, out-of-order batches, 7-day catalog drift
- Invariant checker job in CI + production: nightly recompute of projections vs ledgers
