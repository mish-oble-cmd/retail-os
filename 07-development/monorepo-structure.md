# Monorepo Structure

Target layout once development begins (Phase 0 creates this). Documentation (this repo's numbered folders) stays at the root — docs and code live together.

```
shopify-alternative/                  # rename with product branding later
├── README.md · CLAUDE.md
├── 01-research/ … 08-prompts/        # this documentation base (source of truth)
│
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml               # packages: apps/*, packages/*
├── turbo.json                        # build/test/lint pipelines
├── .github/workflows/                # ci.yml, deploy-api.yml, release-desktop.yml, eas.yml
│
├── packages/
│   ├── config/                       # shared tsconfig, eslint, prettier, tailwind preset
│   ├── domain/                       # PURE business logic (money, tax, cart, promos, loyalty)
│   │   └── src/{money,tax,cart,promotions,loyalty,receipt-model}/ + golden/ tests
│   ├── sync/                         # offline sync engine (outbox, puller, conflict rules)
│   ├── api-client/                   # generated from OpenAPI + typed wrapper
│   └── ui/                           # design system: tokens/ (JSON+CSS), components/, styles/
│
└── apps/
    ├── api/                          # NestJS modular monolith
    │   ├── openapi/v1.yaml
    │   └── src/
    │       ├── modules/{identity,catalog,inventory,orders,customers,loyalty,
    │       │           payments,sync,reports,webhooks,billing,settings}/
    │       │      └── (controller.ts, service.ts, schema.ts, *.spec.ts per module)
    │       ├── db/ (drizzle schema + migrations)  · common/ (tenancy guard, idempotency,
    │       └── workers/ (bullmq processors)          problem-json filter, auth)
    ├── admin/                        # Next.js — src/app/(dashboard|orders|products|...)/
    ├── pos-web/                      # Vite React — src/{screens,features,db(sqlite),hardware(fallbacks)}/
    ├── pos-desktop/                  # Electron — src/main/{printing,updater,ipc}/ loads pos-web build
    └── pos-mobile/                   # Expo RN — src/{screens,features,db,hardware(ble-print,scan)}/
```

## Rules

1. **Dependency direction**: `apps → packages` only; `domain` depends on nothing; `sync` → `domain` only; apps never import apps
2. **Module boundaries in `api`**: a module may not import another module's internals or touch its tables — only its exported service. Enforced with eslint-plugin-boundaries (our packwerk — Shopify lesson)
3. **Feature folders** in clients: `features/<name>/{components,hooks,store}.ts` — screens compose features
4. **Adapters for the physical world**: printing, payments, email, storage, barcode — always behind an interface in the consuming app with a fallback implementation
5. **Codegen is one-way**: never hand-edit `api-client`; change `openapi/v1.yaml` and regenerate (CI verifies no drift)
6. **Docs discipline**: architectural decisions made during coding get appended to the relevant `03-architecture/` doc in the same PR
