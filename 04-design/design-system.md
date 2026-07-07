# Design System — "Counter" (our Polaris)

Shopify lesson S5: design system before screens. All UI in admin, POS web/desktop, and mobile derives from these tokens and components. Implemented in `packages/ui` (React + Tailwind preset + exported tokens JSON consumed by React Native).

## Brand personality

Confident, calm, fast. A tool for busy people in bright, noisy shops: **high contrast, big targets, zero decoration that costs milliseconds.** Admin can be information-dense; POS must be glanceable at arm's length.

## Tokens

### Color
| Token | Value | Use |
|---|---|---|
| `--color-primary` | `#1A4D2E` (deep green) | Actions, focus, brand |
| `--color-primary-hover` | `#143D24` | |
| `--color-accent` | `#F5A623` (amber) | Highlights, pending states |
| `--color-success` | `#1E8E3E` | Paid, synced, positive |
| `--color-warning` | `#F29900` | Offline, low stock, pending sync |
| `--color-danger` | `#D93025` | Refunds, voids, destructive |
| `--color-bg` | `#F7F8F7` | App background |
| `--color-surface` | `#FFFFFF` | Cards, sheets |
| `--color-ink` | `#1C1F1D` | Primary text |
| `--color-ink-muted` | `#5C6660` | Secondary text |
| `--color-border` | `#E2E6E3` | |
Dark mode: defined as parallel token set from Phase 0 (POS night shifts); admin dark mode Phase 5.

### Typography
- Family: **Inter** (UI), **JetBrains Mono** (amounts in tables/receipt preview — tabular numbers mandatory for money: `font-variant-numeric: tabular-nums`)
- Scale (px): 12 caption · 14 body-sm · 16 body (admin default) · 18 POS body · 20 h3 · 24 h2 · 30 h1 · 40 POS total display
- Weights: 400/500/600 only

### Spacing & shape
- 4px base grid; component paddings from {8, 12, 16, 24, 32}
- Radius: 8px default, 12px cards, full for pills
- Shadows: 2 elevations only (card, overlay)

### Touch & density modes
- `density="pos"`: min target 48×48px, body 18px, generous spacing — registers
- `density="admin"`: 36px controls, 14–16px text, dense tables — back office
Same components, density via context provider.

## Core components (build order in Phase 0)

1. Primitives: Button (primary/secondary/ghost/danger; sizes incl. `pos`), Input, NumberPad (POS money/PIN entry), Select, Checkbox/Toggle, Badge, Tag
2. Layout: AppShell (admin sidebar / POS fullscreen), Card, DataTable (sortable, sticky header, footer totals), Sheet/Drawer, Modal, Toast
3. Domain components: MoneyText (always via formatter, tabular nums), ProductTile (grid), CartLine, TenderButton, SyncStatusPill, StatCard (dashboard), Sparkline/BarChart (wrap a chart lib), ReceiptPreview
4. Patterns: EmptyState (with CTA — onboarding matters), ConfirmDestructive (type-to-confirm for voids), PinPad screen, SearchOmnibox (products/customers/orders)

## Iconography

Lucide icons, 20px admin / 24px POS, stroke 1.75. Never icon-only for destructive actions.

## Motion

Fast and rare: 120ms ease-out for state changes, 200ms for sheets. No motion on the sale path that delays interaction. Respect `prefers-reduced-motion`.

## Voice & microcopy

- Verbs on buttons ("Charge ₱1,250.00", not "OK")
- Numbers formatted by store locale/currency always via `@retailos/domain` formatter
- Offline states are calm, not alarming: "Offline — sales are saved on this device" (warning color, no blocking)
- Errors say what to do next

## Accessibility

WCAG 2.1 AA (admin): contrast ≥ 4.5:1, full keyboard nav, focus visible, labels/ARIA on all inputs. POS: barcode-scanner (keyboard wedge) never steals focus from cart; every checkout action reachable without touch (keyboard shortcuts F-keys documented in `06-apps/pos-desktop.md`).
