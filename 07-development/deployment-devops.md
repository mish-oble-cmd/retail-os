# Deployment & DevOps

Small-team-friendly: managed services, boring choices, one command per surface.

## Environments

| Env        | Purpose                                               | Data                          |
| ---------- | ----------------------------------------------------- | ----------------------------- |
| local      | dev; docker-compose (postgres, redis, minio, mailpit) | seeded fixtures               |
| staging    | every merge to main auto-deploys                      | fixtures + sync-chaos nightly |
| production | tagged releases                                       | real; PITR backups            |

## Deploy targets

| Surface            | Target                                                                             | Trigger                       |
| ------------------ | ---------------------------------------------------------------------------------- | ----------------------------- |
| `api` (+ workers)  | Fly.io / Render / ECS — Docker, 2+ instances, managed Postgres + Redis             | tag `api-v*` (staging: merge) |
| `admin`, `pos-web` | Vercel / Cloudflare Pages                                                          | merge (preview per PR)        |
| `pos-desktop`      | electron-builder → GitHub Releases; electron-updater staged rollout (10%→50%→100%) | tag `desktop-v*`              |
| `pos-mobile`       | EAS Build → Play Store/App Store; EAS Update for JS hotfixes                       | tag `mobile-v*`               |

## Client/server compatibility (offline fleet reality)

Old POS clients WILL talk to new servers (devices update slowly, offline for days). Rules:

- Sync protocol versioned in handshake; server supports current + previous 2 minor versions minimum
- API additive-only within v1; fields never repurposed
- SQLite migrations on-device run forward-only at app start; tested against DB snapshots from each supported prior version
- Kill-switch: server can flag a client version as unsupported → client blocks NEW shifts (never an open one) and prompts update

## CI pipeline (GitHub Actions)

PR: lint → typecheck → unit/golden → API integration (Testcontainers) → affected e2e → openapi-drift check → build all. Merge: full e2e + deploy staging. Nightly: sync chaos suite + invariant checker vs staging + dependency audit.

## Operations

- **Migrations**: Drizzle, expand-contract pattern (never breaking read for old API instances during deploy)
- **Backups**: Postgres PITR + daily snapshot, 30-day retention; quarterly restore drill (documented)
- **Monitoring/alerts**: uptime checks, error-rate (Sentry), queue depth, webhook failure rate, **sync lag p95 and conflict rate** (product-critical metrics), payout-affecting jobs paged
- **Status page** public from Phase 5
- **Secrets** in platform secret manager; per-env; rotated on offboarding
- **Runbooks** in `07-development/runbooks/` as incidents teach us (start: restore-from-backup, stuck-sync-batch, webhook-storm)

## Release cadence

Trains: staging continuously; production api/web weekly; desktop biweekly; mobile ~monthly (store review). Hotfix path documented for P0.
