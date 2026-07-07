# Mockup Guidelines

How mockups are produced in this project (by Claude AI or a designer), reviewed, and promoted to implementation.

## Format

- **Single self-contained HTML file** per screen in `04-design/mockups/`, named `<app>--<screen-id-slug>.html` (e.g., `pos--sell.html`, `admin--dashboard.html`)
- Inline CSS using the design tokens from `design-system.md` (copy the token block as CSS variables at the top of each file — keep it in sync)
- No JS frameworks; minimal vanilla JS allowed only to demo a critical interaction (e.g., NumberPad entry)
- Realistic data: real-looking product names, PHP/USD money formatted correctly, plausible quantities — never "Lorem ipsum" or "Product 1"
- Show the primary state PLUS at least one non-happy state (empty/offline/error) as a second section in the same file

## Canvas sizes

| Target                       | Viewport                        |
| ---------------------------- | ------------------------------- |
| POS desktop/tablet landscape | 1280×800                        |
| POS mobile                   | 390×844                         |
| Admin web                    | 1440×900 (must degrade to 1024) |

## Workflow (per screen)

1. Read the screen's row in `screen-inventory.md` + related FRs in the PRD
2. Produce mockup HTML → update the status table in `screen-inventory.md` to `☐ review`
3. User reviews in browser; feedback applied in place
4. Approved → status `☑ approved`; the mockup becomes the visual contract for implementation
5. Implementation may deviate only for technical reasons, documented in the PR description

## Review checklist (applies to every mockup)

- [ ] Uses tokens (no ad-hoc colors/sizes)
- [ ] POS density: ≥48px touch targets, 18px+ text, total readable at 1 meter
- [ ] Money right-aligned, tabular numerals, currency correct
- [ ] Primary action is the visually dominant element (e.g., Charge button)
- [ ] Sync/offline indicator present on POS screens
- [ ] Empty + error/edge state included
- [ ] Destructive actions styled danger + not adjacent to primary
- [ ] Keyboard/barcode-first flow is plausible (desktop POS)

## Fidelity ladder

- **Phase 0**: token sheet + 3 flagship mockups (POS-03 Sell, POS-04 Payment, ADM-02 Dashboard) to lock the visual language
- **Each later phase**: mock all new screens for that phase before implementation begins (a phase's "mockup gate")
