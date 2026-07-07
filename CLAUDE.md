# CLAUDE.md — Instructions for AI agents working in this repo

This repository is a **documentation codebase** for building "RetailOS", a POS platform (web admin + desktop POS + mobile POS) inspired by a study of Shopify. Code will live in `apps/` and `packages/` once development starts (see `07-development/monorepo-structure.md`).

## Ground rules

1. **Docs are the source of truth.** Requirements come from `02-product/`, technical decisions from `03-architecture/`, UI decisions from `04-design/`. If a needed decision is missing, propose it, get user approval, write it into the relevant doc, THEN implement.
2. **Follow the phase plan.** `05-roadmap/phases-overview.md` defines scope per phase. Do not build features from a later phase, even if easy. Flag scope creep.
3. **Mockups before implementation.** For any new screen, produce an HTML/SVG mockup per `04-design/mockup-guidelines.md` and get approval before writing app code.
4. **Offline-first is non-negotiable** for the POS apps (desktop & mobile). Every POS feature must answer: "what happens when the network is down?" See `03-architecture/offline-sync-strategy.md`.
5. **Money is integers.** All amounts are stored in minor units (cents/centavos) as integers. Never floats. See `03-architecture/data-model.md`.
6. **Multi-tenant from day one.** Every business table carries `store_id`. See `03-architecture/data-model.md`.

## Tech stack (summary — details in `03-architecture/tech-stack.md`)

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript everywhere
- **Web admin:** Next.js (App Router) + React + Tailwind CSS
- **Desktop POS:** Electron wrapping the shared React POS app
- **Mobile POS:** React Native (Expo)
- **API:** Node.js (NestJS), REST + webhooks; PostgreSQL; Redis
- **Offline store:** SQLite (desktop/mobile) with sync engine
- **Shared packages:** `@retailos/ui`, `@retailos/domain`, `@retailos/sync`, `@retailos/api-client`

## Conventions

- TypeScript strict mode; no `any` without a `// why:` comment
- Follow `07-development/coding-standards.md` for naming, errors, commits
- Every feature ships with tests per `07-development/testing-strategy.md`
- Update the phase checklist in `05-roadmap/` when completing milestones

## When the user says…

- "start phase N" → read `05-roadmap/phase-N-*.md` + the matching prompt in `08-prompts/`, restate scope and acceptance criteria, then begin
- "mockup X" → follow `04-design/mockup-guidelines.md` and the screen spec in `04-design/screen-inventory.md`
- "add feature X" → check `02-product/feature-requirements.md`; if absent, write the requirement first
