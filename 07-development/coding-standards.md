# Coding Standards

## TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`; no `any`/`as` without `// why:` comment
- Domain types are branded where confusion is dangerous: `Money`, `Ulid`, `StoreId` (no bare strings/numbers for money or ids crossing function boundaries)
- Prefer discriminated unions over boolean flags; exhaustive `switch` with `never` check
- Errors: expected failures return `Result<T, DomainError>` in `domain`/`sync`; apps may throw typed exceptions at the edge. Never throw strings

## Naming
- Files kebab-case; React components PascalCase; DB snake_case; API JSON snake_case
- Booleans read as predicates (`isOffline`, `canRefund`); handlers `handleX`; domain functions are verbs (`calculateCartTotals`)
- No abbreviations except industry-standard (SKU, PO, qty)

## Money & time (non-negotiable)
- Money: integer minor units via `Money` type; all arithmetic through `packages/domain/money`; formatting only via its formatter
- Time: store UTC, display store-timezone; never `new Date()` in domain code (clock injected — testability + skew handling)

## React
- Server state: TanStack Query (admin) / SQLite queries (POS). UI state: Zustand slices per feature. No global god-store
- Components take domain objects, not raw API rows; mapping at the feature boundary
- No business math in components — `@retailos/domain` only (offline correctness depends on this)

## API (NestJS)
- Controller = transport only (validation, auth, mapping); service = use case; one use case per public service method
- Every mutation: tenant guard + permission check + audit hook where FR-5.3 applies
- All handlers idempotency-aware where they create facts

## Git & PRs
- Conventional commits (`feat(pos): park cart`); branch `phase-N/short-name`
- PR template: what/why, FR refs, screenshots for UI, test evidence, docs-updated checkbox
- CI green required; no direct pushes to main

## Comments & docs
- Comment constraints and invariants, not narration ("qty may be negative here: refund restock")
- Every package has a README stating its purpose and rules; update when rules change
- ADRs: significant decisions appended to `03-architecture/` docs in the same PR (see monorepo rule 6)

## Definition of Done (any task)
Code + tests per testing-strategy + mockup fidelity (UI) + offline behavior stated (POS) + permission behavior stated + docs updated + demo-able.
