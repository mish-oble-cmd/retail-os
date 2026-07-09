# Screen Inventory

Every screen across the three apps, with purpose, key elements, and phase. Mockups are produced per `mockup-guidelines.md` and stored in `04-design/mockups/` as HTML files named `<app>--<screen-id>.html`.

## POS (shared spec for desktop/web `pos-web` and mobile `pos-mobile`; layout differs — see per-app docs in `06-apps/`)

| ID     | Screen                    | Phase          | Key elements                                                                                                                                                                                    |
| ------ | ------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POS-01 | Register activation       | 1              | Activation code entry, store/register confirmation                                                                                                                                              |
| POS-02 | PIN lock                  | 1              | PinPad, staff avatars, offline indicator                                                                                                                                                        |
| POS-03 | **Sell** (home)           | 1              | Product grid (tiles+categories) / search bar / barcode focus trap; cart panel: lines, qty steppers, discounts, customer chip, subtotal→total; Charge button (shows total); park cart; sync pill |
| POS-04 | Payment                   | 1              | Total display (40px), tender buttons (cash/card/custom), cash NumberPad + quick-amount chips, split payment rows, change due result                                                             |
| POS-05 | Receipt/Done              | 1              | Change reminder, print/email/QR buttons, new-sale (auto-return timer)                                                                                                                           |
| POS-06 | Parked carts              | 1              | List with name/age/total, retrieve/discard                                                                                                                                                      |
| POS-07 | Orders (register history) | 1              | Search by number/date/customer, order detail, start refund                                                                                                                                      |
| POS-08 | Refund/exchange flow      | 1 (exchange 2) | Line selection, qty, restock toggles, tender for refund, manager PIN gate                                                                                                                       |
| POS-09 | Customer attach/create    | 2              | Phone-first search, quick-create form, history peek, loyalty balance (4)                                                                                                                        |
| POS-10 | Shift open/close          | 1              | Float count NumberPad, blind close count, over/short reveal (permission), paid in/out                                                                                                           |
| POS-11 | Stock lookup              | 2              | Search item → per-location quantities (4: other branches)                                                                                                                                       |
| POS-12 | Settings/diagnostics      | 1              | Printer setup+test, sync health, app version, sign-out register                                                                                                                                 |
| POS-13 | Custom sale sheet         | 1              | Name, price NumberPad, tax category                                                                                                                                                             |
| POS-14 | Discount sheet            | 1              | % / fixed toggle, NumberPad, reason; code entry (2)                                                                                                                                             |

## Admin (web, `admin`)

| ID     | Screen                          | Phase | Key elements                                                                                               |
| ------ | ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| ADM-01 | Signup & onboarding wizard      | 1     | Store profile, currency/tax, sample-data offer, "first sale" checklist                                     |
| ADM-02 | **Dashboard**                   | 2     | StatCards (today revenue/txns/basket), sales-by-hour chart, top items, location filter, sync health banner |
| ADM-03 | Products list                   | 1     | DataTable, search/filter, bulk actions, import/export                                                      |
| ADM-04 | Product editor                  | 1     | Details, options→variant matrix, prices/costs, barcodes, images, per-location stock                        |
| ADM-05 | Categories                      | 1     | Tree manage, drag ordering                                                                                 |
| ADM-06 | Inventory levels                | 2     | Variant×location grid, quick adjust (reasoned), negative/low-stock filters                                 |
| ADM-07 | Purchase orders                 | 2     | List+detail, receive flow (partial), supplier picker, cost updates                                         |
| ADM-08 | Transfers                       | 4     | Create, dispatch, receive, discrepancy                                                                     |
| ADM-09 | Stock counts                    | 2     | Session setup (filters), count entry, variance review, post                                                |
| ADM-10 | Suppliers                       | 2     | CRUD                                                                                                       |
| ADM-11 | Orders list+detail              | 1     | Timeline, payments, refund from admin, receipt resend                                                      |
| ADM-12 | Customers list+profile          | 2     | Segments-lite (tag filter), history, loyalty admin (4), consent                                            |
| ADM-13 | Promotions & codes              | 2     | Rule builder (type/scope/schedule), code generator                                                         |
| ADM-14 | Reports hub                     | 2     | Report picker, filters, table+chart, CSV export                                                            |
| ADM-15 | Staff & roles                   | 2     | Staff CRUD, role/permission editor, PIN reset, audit log viewer                                            |
| ADM-16 | Locations & registers           | 1     | CRUD, activation codes, register layout editor (grid designer)                                             |
| ADM-17 | Settings: taxes/tenders/receipt | 1     | Tax rates+categories, tender types, receipt template editor with live ReceiptPreview                       |
| ADM-18 | Settings: billing/plan          | 3     | Plan picker, invoices (Stripe portal embed)                                                                |
| ADM-19 | Sync health                     | 3     | Device list, last-seen, pending batches, conflict queue with resolve actions                               |
| ADM-20 | API keys & webhooks             | 5     | Key CRUD w/ scopes, webhook subscriptions, delivery log + replay                                           |

## Cross-cutting states (every mockup must show where relevant)

Offline banner · empty state (with CTA) · loading skeleton · error state · permission-denied (PIN escalation) · sync-pending badge on unsynced orders.

## Mockup production status

Maintain this table as mockups are produced/approved:

| Screen                   | Mockup file                     | Status                |
| ------------------------ | ------------------------------- | --------------------- |
| POS-03                   | `mockups/pos--sell.html`           | ☑ approved 2026-07-09 |
| POS-04                   | `mockups/pos--payment.html`        | ☑ approved 2026-07-09 |
| ADM-02                   | `mockups/admin--dashboard.html`    | ☑ approved 2026-07-09 |
| POS-01                   | `mockups/pos--activation.html`     | ☑ approved 2026-07-09 |
| POS-02                   | `mockups/pos--pin-lock.html`       | ☑ approved 2026-07-09 |
| POS-05                   | `mockups/pos--receipt-done.html`   | ☑ approved 2026-07-09 |
| POS-13                   | `mockups/pos--custom-sale.html`    | ☑ approved 2026-07-09 |
| POS-14                   | `mockups/pos--discount-sheet.html` | ☑ approved 2026-07-09 |
| POS-06                   | `mockups/pos--parked-carts.html`   | ☑ approved 2026-07-10 |
| POS-07                   | `mockups/pos--orders.html`         | ☑ approved 2026-07-10 |
| POS-08                   | `mockups/pos--refund.html`         | ☑ approved 2026-07-10 |
| POS-10                   | `mockups/pos--shift.html`          | ☑ approved 2026-07-10 |
| POS-12                   | `mockups/pos--settings.html`       | ☑ approved 2026-07-10 |
| ADM-03                   | `mockups/admin--products.html`     | ☑ approved 2026-07-10 |
| ADM-04                   | `mockups/admin--product-editor.html` | ☑ approved 2026-07-10 |
| ADM-05                   | `mockups/admin--categories.html`   | ☑ approved 2026-07-10 |
| ADM-01                   | `mockups/admin--signup-onboarding.html` | ☑ approved 2026-07-10 |
| ADM-11                   | `mockups/admin--orders.html`       | ☑ approved 2026-07-10 |
| ADM-16                   | `mockups/admin--locations-registers.html` | ☑ approved 2026-07-10 |
| ADM-17                   | `mockups/admin--settings-taxes-tenders-receipt.html` | ☑ approved 2026-07-10 |
| _(add rows as produced)_ |                                    |                       |

2026-07-10: all previously approved mockups (POS-01…05, POS-13, POS-14, ADM-02) retrofitted to the frontend-design polish pass — Lucide inline SVG icons replacing emoji, eyebrow labels, mono/tabular figures. Layouts unchanged; approvals stand.
