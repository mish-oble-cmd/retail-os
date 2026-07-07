# Shopify Feature Catalog

Inventory of Shopify's feature surface, weighted toward POS. Used as the checklist we scope RetailOS against (see `02-product/feature-requirements.md` for what we actually build, per phase).

## 1. POS features (Shopify POS Lite vs Pro)

### Selling / checkout

- Product search, barcode scan, browse by collection; smart grid (customizable tile layout)
- Cart: line items, quantity, per-line and cart-level discounts (% / fixed / code)
- Custom sale (ad-hoc item with price typed in)
- Taxes auto-calculated by location; tax overrides/exemptions
- Payment types: card (integrated readers), cash (with change calc), gift card, split payments, custom/manual types (e.g., bank transfer)
- Receipts: printed, email, SMS; gift receipts (Pro)
- Park/retrieve carts; sell across catalog even if item not stocked locally
- Returns, refunds (to original tender), exchanges (Pro)
- Order history lookup from register

### Customers

- Attach customer to sale; create/edit at register
- Purchase history visible at POS; notes, tags
- Loyalty via apps (not native — gap)

### Staff (Pro)

- PIN login per staff member; role-based permissions (discount limits, refund rights, register access)
- Sales attribution per staff member

### Inventory (Pro)

- Multi-location stock; stock lookup at other locations from register
- Stock counts/cycle counts, receiving, purchase orders, transfers
- Low-stock alerts (basic)

### Register operations

- Cash tracking sessions: float, paid in/out, end-of-day count, discrepancy report (Pro)
- Daily sales summary / Z-report equivalent
- Offline: **cash-only degraded mode**; card payments and many features fail offline (major gap)

### Hardware

- Proprietary + certified readers (WisePad, POS Go, countertop kit), receipt printers, barcode scanners, cash drawers

### Omnichannel (Pro)

- Buy online pickup in store (BOPIS), ship-to-customer from register, buy in store/ship to home, local delivery
- Unified customer + order history across channels

## 2. Admin (back office) features

- **Products**: variants (3 options → up to ~2,000 variants), collections (manual/smart), media, SEO fields, metafields (custom data), bulk editor, CSV import/export
- **Inventory**: per-location levels, adjustments with reasons, transfers, purchase orders (newer), ABC analysis
- **Orders**: timeline/audit trail, order editing, draft orders (quotes), fulfillment holds, returns/refunds, high-risk fraud flags
- **Customers**: segments (query language), tags, marketing consent, metafields
- **Discounts**: codes, automatic, buy-X-get-Y, tiered via Functions
- **Analytics**: dashboard (sales, top products, staff), 60+ reports, custom reports (Advanced+), retail-specific reports (sales by register/staff/location)
- **Staff & permissions**: granular admin permissions, POS roles separate
- **Settings**: taxes, shipping, payments, markets/currencies, locations, notifications (email templates), policies
- **Marketing**: email (Shopify Email), automations (Flow), campaigns/attribution
- **Finance**: Payments payouts, Balance (banking), Capital (lending), Bill Pay, Tax filing

## 3. Platform / ecosystem features

- App Store (10k+ apps), theme store, Flow automation, Functions (custom logic), Hydrogen (headless), Markets (cross-border), B2B (Plus), Fulfillment network integrations, Shop app + Shop Pay (consumer side), Sidekick/Magic (AI assistant, product description generation, etc.)

## 4. Feature-tier map (what's paywalled where)

| Capability                       | Free/Lite | Pro/Paid tier |
| -------------------------------- | --------- | ------------- |
| Basic selling, cash/card         | ✔         | ✔             |
| Receipts (print/email)           | ✔         | ✔             |
| Staff PINs & roles               | ✖         | ✔             |
| Exchanges                        | ✖         | ✔             |
| Purchase orders, counts          | ✖         | ✔             |
| BOPIS / omnichannel fulfillment  | ✖         | ✔             |
| Cash session discrepancy reports | ✖         | ✔             |
| Custom printed receipts          | ✖         | ✔             |

**Lesson:** the free tier sells; the paid tier _operates a real store_ (staff, inventory ops, cash controls, omnichannel). We mirror this split in our pricing (see `02-product/vision-and-strategy.md`).

## 5. Notable native gaps (opportunities)

- Weak offline mode (cash-only, no card, sync fragility)
- No native loyalty program (app required)
- No native appointments/services selling (retail-goods bias)
- Limited wholesale/B2B outside Plus
- No true "open tabs" / hospitality mode (bars, cafés need apps)
- Reporting depth locked behind expensive plans
- No native multi-currency cash drawer / market-specific tax quirks (e.g., PH BIR receipt compliance, EU fiscal printers) — regional compliance is app territory
