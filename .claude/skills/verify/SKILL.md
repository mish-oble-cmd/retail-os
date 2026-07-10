---
name: verify
description: How to build, launch, and drive RetailOS locally to verify changes end-to-end (API + admin against real Postgres).
---

# Verifying RetailOS locally

## Stack up

```bash
colima start                                   # Docker runtime (macOS)
docker compose up -d postgres minio mailpit    # Postgres :5433, MinIO :9000, Mailpit :8025
cd apps/api && DATABASE_URL='postgres://retailos:retailos@localhost:5433/retailos' pnpm migrate
```

Servers are defined in `.claude/launch.json` (preview_start names):
- `api` → NestJS on :3001 (builds first; restart wipes in-memory sessions — log in again)
- `admin` → Next.js on :3000 (expects API on :3001; CORS pre-configured)

## Drive

- Signup at `/signup` creates store + Owner only. **A fresh store has no tax
  category, location, or register until 1E onboarding ships** — seed them via
  psql before exercising catalog stock or registers.
- Seeded IDs must match the Crockford ULID alphabet `[0-9A-HJKMNP-TV-Z]{26}`
  — no I, L, O, U — or every endpoint 400s with "Validation failed".
- File-input flows (CSV import) drive fine via `DataTransfer` + synthetic
  `change` event in preview_eval.
- React controlled inputs need the native value-setter trick
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`)
  before dispatching `input`.

## Gotchas

- psql connects as the `retailos` superuser: RLS does NOT apply there —
  don't use psql output to reason about tenant isolation.
- The app's tenant wrapper (`apps/api/src/db/tenant-db.ts`) drops to
  `retailos_app` per transaction; new tables must GRANT to that role in the
  migration or every query on them fails once deployed.
