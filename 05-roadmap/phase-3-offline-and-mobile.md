# Phase 3 — Offline-First Certification & Mobile POS

**Goal:** make the marquee claim provable — 7 days fully offline, chaos-tested sync — and ship the mobile POS. Turn on billing.

**FRs:** FR-1.9 (full), NFR-1, billing (FR-10.2 §billing), mobile app parity for the sell path.

## Workstreams

### 3A Sync hardening

Implement the full conflict matrix from `offline-sync-strategy.md` (stale price, negative stock, customer merge, loyalty cap scaffolding, staff deactivation, over-refund, clock skew). SyncConflict persistence + ADM-19 Sync Health screen (device list, pending, conflict queue with resolve actions). Catalog staleness banner; 30-day re-bootstrap rule; kill-switch device revocation (wipe on contact).

### 3B Sync test rig

Deterministic simulator: N virtual registers × scripted scenario files → assert final server state. Chaos suite: process kill mid-transaction, duplicate/out-of-order batch delivery, 7-day drift replay. Nightly invariant checker (ledger vs projections) in CI and against staging.

### 3C Mobile POS (`pos-mobile`)

Expo RN app: activation, PIN, sell (camera scan + search + compact grid), cart, cash/manual-card/split, park, refunds, shift open/close, BLE/TCP ESC/POS printing, receipt share (email/QR). Same SQLite sync engine. Phone-portrait-first layout per `06-apps/pos-mobile.md`. EAS builds + store listings prep.

### 3D Billing & plans

Stripe Billing integration: Free/Standard/Growth per vision doc; plan gates enforced server-side (registers count, staff count, feature flags); ADM-18; grace handling on payment failure (never brick the register mid-shift — degrade to read-only admin instead).

### 3E Browser-POS storage decision

Implement wa-sqlite/OPFS path or formally declare browser mode online-preferred (see architecture doc) — decide with data, document in `06-apps/`.

## Acceptance criteria

- [ ] **The 7-day test**: register sells realistic volume with network disabled for 7 days (accelerated harness) → reconnect → zero lost sales, all conflicts correctly categorized
- [ ] Chaos suite green 50 consecutive runs
- [ ] Mobile: full demo-script of Phase 1 acceptance (minus desktop-only items) passes on Android + iOS hardware
- [ ] BLE printer prints receipt from phone; QR receipt scans to web view
- [ ] Upgrade Free→Standard unlocks staff roles without redeploy; downgrade blocks gracefully
- [ ] Sync Health screen shows a manufactured conflict and a human resolves it
- [ ] Invariant checker runs nightly against staging with zero violations for 2 weeks

## Out of scope

Integrated payments, loyalty redemption, multi-location, modifiers.
