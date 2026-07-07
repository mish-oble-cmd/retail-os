# RetailOS — POS Platform Documentation Codebase

A complete documentation codebase for building a Shopify-inspired **Point of Sale (POS) platform** with desktop, web, and mobile apps. This repo is designed to be handed to Claude AI (or any AI coding agent) as the single source of truth for planning, mockups, and phased development.

> "RetailOS" is a working codename — replace it globally with your product name when you decide on one.

## How to use this repo with Claude AI

1. **Start every session** by having Claude read `CLAUDE.md` (it will do this automatically in Claude Code).
2. **Work phase by phase.** Open `05-roadmap/phases-overview.md`, pick the current phase, and use the matching prompt template in `08-prompts/`.
3. **Never let the AI invent requirements.** If something isn't specified here, update the docs first, then build.
4. **Mockups before code.** Each phase has a mockup step (see `04-design/`) that must be approved before implementation.

## Repository map

| Folder | Purpose |
|---|---|
| `01-research/` | Shopify study: business model, architecture, features, strengths/weaknesses |
| `02-product/` | What WE are building: vision, personas, requirements (PRD) |
| `03-architecture/` | System design: tech stack, data model, APIs, offline sync, security |
| `04-design/` | Design system, screen inventory, mockup specifications |
| `05-roadmap/` | Development phases, milestones, acceptance criteria |
| `06-apps/` | Per-app specifications: web admin, desktop POS, mobile POS |
| `07-development/` | Monorepo structure, coding standards, testing, deployment |
| `08-prompts/` | Ready-to-paste Claude AI prompt templates per phase |

## Reading order (first time)

1. `01-research/shopify-business-model.md` → understand what we're learning from
2. `01-research/strengths-weaknesses-opportunities.md` → where we differentiate
3. `02-product/vision-and-strategy.md` → what we're building and why
4. `02-product/feature-requirements.md` → the PRD
5. `03-architecture/system-architecture.md` → how it fits together
6. `05-roadmap/phases-overview.md` → the build order

## Status

- [x] Research & documentation complete
- [ ] Phase 0 — Foundations & design system
- [ ] Phase 1 — Core POS MVP (web + desktop)
- [ ] Phase 2 — Back office & inventory
- [ ] Phase 3 — Mobile POS & offline-first
- [ ] Phase 4 — Payments, hardware & multi-location
- [ ] Phase 5 — Ecosystem: reports, integrations, API
