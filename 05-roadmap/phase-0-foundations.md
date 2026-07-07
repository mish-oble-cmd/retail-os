# Phase 0 — Foundations

**Goal:** a deployed walking skeleton + the design system + the money/tax core, so every later phase is assembly, not archaeology.

## Deliverables

### 0.1 Monorepo scaffold

- pnpm + Turborepo per `07-development/monorepo-structure.md`; all `apps/*` and `packages/*` stubs building
- Shared tsconfig/eslint/prettier (`packages/config`); strict mode on
- GitHub Actions: lint, typecheck, test, build on every PR; preview deploys

### 0.2 `@retailos/domain` core

- `Money` type + arithmetic + locale formatting (integer minor units)
- Tax engine per `data-model.md` §Tax (inclusive/exclusive, multi-rate, rounding) — **golden test file with ≥40 cases** including the nasty rounding ones
- Cart calculator v1: lines, qty, line/cart discounts (%/fixed), totals
- Zero runtime dependencies

### 0.3 Design system v1 (`packages/ui`)

- Tokens (CSS vars + JSON export) from `04-design/design-system.md`
- Primitives: Button, Input, NumberPad, Badge, Card, Modal, Toast, DataTable (basic), MoneyText
- Storybook (decided over Ladle) deployed for review
- Flagship mockups produced & approved: POS-03 Sell, POS-04 Payment, ADM-02 Dashboard

### 0.4 API skeleton (`apps/api`)

- NestJS app, module folders per architecture doc (empty but wired)
- Postgres + Drizzle migrations bootstrapped; `Store`, `Staff`, `Location`, `Register` tables
- Auth: signup/login (argon2id), session cookies, TOTP enrollment; tenant-guard ORM wrapper + RLS migration + **tenant-isolation test proving cross-store queries fail**
  - Minimal Phase 0 signup (approved): email + password + store name + currency → creates `Store` + Owner `Staff` (with `password_hash`). Full onboarding wizard is FR-10.1, Phase 1. TOTP enrollment optional in Phase 0; enforced for Owner from Phase 1.
- OpenAPI generation pipeline → `@retailos/api-client` codegen working end to end
- Health endpoint; deployed to chosen host; Sentry + pino wired

### 0.5 Client shells

- `admin`: Next.js with AppShell, login → empty dashboard
- `pos-web`: Vite React app with PIN-lock screen (static PIN), density=pos theme, runs fullscreen
- `pos-desktop`: Electron loading pos-web, auto-update wiring, prints a **test receipt to a virtual ESC/POS printer** (emulator; approved 2026-07-08 — real-hardware verification moves to the hardware lab checklist in `06-apps/pos-desktop.md`)
- `pos-mobile`: Expo app boots, renders tokens, camera barcode scan spike reading an EAN

## Explicitly OUT

Products, carts against real data, sync, payments — nothing merchant-visible beyond login.

## Exit criteria

- [ ] `pnpm build && pnpm test` green across repo; CI enforcing
- [ ] Domain golden tests pass; coverage ≥ 90% on domain
- [ ] Signup → login → empty admin works on the deployed URL
- [ ] Electron app prints test receipt; Expo app scans a barcode
- [ ] 3 flagship mockups approved; Storybook deployed
- [ ] Tenant-isolation test suite green
