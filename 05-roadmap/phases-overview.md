# Development Phases Overview

Six phases, each independently shippable and demo-able. Durations assume one developer + Claude AI working steadily; treat as relative sizing, not promises. Each phase has a detail file (`phase-N-*.md`) with scope, tasks, and acceptance criteria, and a matching prompt template in `08-prompts/`.

## Phase gate rules

A phase starts only when the previous phase's **exit criteria** are checked off. Each phase follows the same internal sequence:
**mockups → approval → data model & API → implementation → tests → demo checklist.**

## Timeline

| Phase | Name                                | Focus                                                                                                   | Est.    | Ships                                                                                                                    |
| ----- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| **0** | Foundations                         | Monorepo, CI, design system, auth skeleton, walking skeleton                                            | 2–3 wk  | Deployed "hello commerce": login → empty admin; POS shell with PIN lock; `@retailos/domain` money/tax core golden-tested |
| **1** | Core POS MVP                        | Sell things, take money, print receipts — online-tolerant (local queue, basic sync)                     | 6–8 wk  | Usable single-register POS (web+desktop) + minimal admin (products, orders, settings, onboarding)                        |
| **2** | Back office depth                   | Inventory ops, customers, staff/roles, reports, promotions                                              | 6–8 wk  | A real store can run on RetailOS daily                                                                                   |
| **3** | Offline-first & mobile              | Full sync engine hardening, conflict handling, 7-day offline cert, mobile POS app, billing              | 6–8 wk  | Mobile POS in stores; offline is a provable claim; paid tiers live                                                       |
| **4** | Payments, hardware & multi-location | Stripe Terminal + adapter layer, gift/store credit, loyalty, modifiers/bundles, transfers, multi-branch | 8–10 wk | Chains + cafés served; integrated card payments                                                                          |
| **5** | Platform                            | Public API + webhooks docs, advanced reports, exports, integrations (accounting), API keys UI, polish   | 6–8 wk  | v1.0 launch                                                                                                              |

## Scope allocation (FR → phase)

| Area                | P0           | P1                          | P2                | P3           | P4                         | P5                |
| ------------------- | ------------ | --------------------------- | ----------------- | ------------ | -------------------------- | ----------------- |
| Selling FR-1        | —            | 1.1–1.8 (basic) 1.9 (queue) | codes 1.2         | 1.9 hardened | terminal 1.5, gift         | —                 |
| Catalog FR-2        | —            | 2.1–2.2 basic               | 2.2 full, 2.6 CSV | —            | 2.4 modifiers, 2.5 bundles | 2.3 sched. prices |
| Inventory FR-3      | —            | 3.1 ledger (sales)          | 3.2–3.7           | —            | transfers 3.4 multi-loc    | —                 |
| Customers FR-4      | —            | —                           | 4.1–4.2           | —            | 4.3 loyalty, 4.4 credit    | —                 |
| Staff FR-5          | auth core    | PIN 5.1                     | 5.2–5.3           | —            | —                          | —                 |
| Cash FR-6           | —            | 6.1–6.2                     | reports           | —            | —                          | —                 |
| Reports FR-7        | —            | daily summary               | 7.1–7.2           | —            | multi-loc                  | 7.2 advanced      |
| Multi-location FR-8 | —            | (single)                    | —                 | —            | 8.1–8.3                    | —                 |
| Payments FR-9       | —            | manual card                 | —                 | —            | 9.1–9.3                    | —                 |
| Platform FR-10      | 10.4 tenancy | 10.1–10.2                   | —                 | billing      | —                          | 10.3 API          |

## Standing exit criteria (every phase)

- [ ] All phase mockups approved before their screens were built
- [ ] All phase FR acceptance criteria demoed against the checklist in the phase file
- [ ] Test suite green; coverage of `@retailos/domain` ≥ 90%
- [ ] No open P0/P1 bugs; `security-review` pass on the diff of the phase
- [ ] Docs updated (this repo) for any decision made during the phase
- [ ] Demo recorded/performed following the phase's demo script

## Risk register (watch continuously)

| Risk                           | Mitigation                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sync complexity explodes       | Sync simulator tests from Phase 1; facts-up/reference-down discipline; never edit-both-sides entities                                  |
| Printer/hardware fragmentation | Certify short list (Epson TM series, XPrinter, generic ESC/POS); adapter interface; hardware lab checklist in `06-apps/pos-desktop.md` |
| Scope creep toward e-commerce  | Vision doc scope boundaries; CLAUDE.md rule 2                                                                                          |
| Solo-dev burnout               | Phases shippable → motivation; ruthless Could-cutting                                                                                  |
