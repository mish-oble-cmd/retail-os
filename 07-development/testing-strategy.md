# Testing Strategy

Risk-weighted: the money math and the sync engine get the heaviest coverage; UI gets targeted e2e on the sell path.

## Pyramid & tools

| Layer           | Tool                                        | What                                                                                                                                                                                                        |
| --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit            | Vitest                                      | domain (goal ≥90% coverage), sync rules, utilities                                                                                                                                                          |
| Golden tests    | Vitest + fixture files                      | Tax/cart/promotion calculations: human-verified `input → expected` JSON fixtures in `packages/domain/golden/`. Adding a case never breaks unrelated ones; changing expected output requires explicit review |
| Property tests  | fast-check                                  | Money arithmetic invariants (no lost cents in splits/refunds), promotion stacking bounds, `Σ movements == level`                                                                                            |
| API integration | Vitest + Testcontainers (Postgres/Redis)    | Module services against real DB; tenant-isolation suite (cross-store access must fail); idempotency replay suite                                                                                            |
| Sync simulation | Custom rig (Phase 1 seed, Phase 3 full)     | Scripted multi-register scenarios → assert final server state; chaos mode (kill, duplicate, reorder, 7-day drift)                                                                                           |
| E2E web         | Playwright                                  | Admin critical paths; POS sell path incl. **offline e2e**: `context.setOffline(true)` → sell → online → assert synced-once                                                                                  |
| E2E mobile      | Maestro                                     | Sell path on Android emulator + 1 real low-end device before release                                                                                                                                        |
| Perf            | k6 (API), custom timers (POS budgets NFR-2) | Phase 5 gate, tracked from Phase 2                                                                                                                                                                          |

## Non-negotiable suites (CI-blocking from the phase they exist)

1. **Domain golden tests** — the cash register's honesty
2. **Tenant isolation** — one leaked query is game over
3. **Idempotency replay** — every fact-creating endpoint × duplicate delivery
4. **Offline sell e2e** — the marquee claim, tested on every PR touching pos-* or sync
5. **Invariant checker** — ledger vs projection recompute (CI + nightly staging)

## Test data

`packages/domain/fixtures`: canonical demo store (50 products incl. variant matrix, 3 tax setups incl. inclusive VAT, promo set, 2 locations). Used by seeds, Storybook, e2e, and the demo environment — one realistic dataset everywhere.

## Manual test gates

- Phase demo scripts (in each phase doc) executed on reference hardware
- Hardware lab checklist (printers/scanners/readers) per `06-apps/pos-desktop.md` before desktop releases
- Exploratory "cashier abuse" session per phase: rapid taps, scan floods, drawer-open spam, mid-payment app kill

## Bug policy

P0 (money wrong, data loss, tenant leak): stop-ship, fix + regression test + postmortem note in docs. P1 (feature broken, workaround exists): fix before phase exit. P2/P3: triaged to backlog.
