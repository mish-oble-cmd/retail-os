import { argon2id } from 'hash-wasm';
import {
  migrateDeviceDb,
  openBrowserDriver,
  taxRatesByCategory,
  type BrowserDriverHandle,
  type SqlDriver,
  type TaxRateRow,
} from '@retailos/sync';
// Vite serves the sql.js wasm from node_modules as a hashed asset URL.
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

/**
 * Device bootstrap for pos-web (1C). Opens the browser SqlDriver (sql.js +
 * best-effort OPFS snapshot), migrates the schema, and — for local dev without
 * a live API — seeds a small demo catalog + staff so the Sell screen has
 * something to sell. When the register is activated against a real API, the
 * bootstrap/delta sync overwrites this mirror.
 */
export async function openDevice(): Promise<BrowserDriverHandle> {
  const handle = await openBrowserDriver({ locateFile: () => sqlWasmUrl });
  migrateDeviceDb(handle.driver);
  await seedDemoIfEmpty(handle.driver);
  return handle;
}

const STORE_ID = 'DEMOSTORE';
const LOCATION_ID = 'DEMOLOC1';
const TAX_CATEGORY_ID = 'DEMOTAXC';
const TAX_RATE_ID = 'DEMOTAXR'; // VAT 12% inclusive

/** Owner Ana (PIN 0042), Cashier Ben (PIN 1234) — mirrors the 1F demo world. */
const DEMO_STAFF = [
  { id: 'DEMO-ANA', name: 'Ana', roleId: 'owner', pin: '0042', active: 1 },
  { id: 'DEMO-BEN', name: 'Ben', roleId: 'cashier', pin: '1234', active: 1 },
  { id: 'DEMO-CARA', name: 'Cara', roleId: 'cashier', pin: null, active: 1 },
  { id: 'DEMO-DENG', name: 'Deng', roleId: 'cashier', pin: '9999', active: 0 },
] as const;

interface DemoProduct {
  name: string;
  category: string;
  price: number; // centavos
  barcode: string;
  stock: number;
}

const DEMO_CATEGORIES = [
  { id: 'CATPSL', name: 'Pasalubong' },
  { id: 'CATBEV', name: 'Beverages' },
  { id: 'CATPAN', name: 'Pantry' },
  { id: 'CATSNK', name: 'Snacks' },
  { id: 'CATHOM', name: 'Home' },
];

const DEMO_PRODUCTS: DemoProduct[] = [
  { name: 'Dried Mangoes 200g', category: 'CATPSL', price: 18500, barcode: '4800001000017', stock: 40 },
  { name: 'Barako Coffee Beans 250g', category: 'CATBEV', price: 32000, barcode: '4800001000024', stock: 25 },
  { name: 'Banana Chips 100g', category: 'CATSNK', price: 6500, barcode: '4800001000031', stock: 60 },
  { name: 'Calamansi Concentrate 500ml', category: 'CATBEV', price: 14500, barcode: '4800001000048', stock: 18 },
  { name: 'Coco Sugar 500g', category: 'CATPAN', price: 22000, barcode: '4800001000055', stock: 30 },
  { name: 'Ube Halaya Jar 340g', category: 'CATPSL', price: 16500, barcode: '4800001000062', stock: 3 },
  { name: 'Polvoron Assorted 12s', category: 'CATPSL', price: 13800, barcode: '4800001000079', stock: 22 },
  { name: 'Sampaguita Soap 90g', category: 'CATHOM', price: 4800, barcode: '4800001000086', stock: 50 },
  { name: 'Muscovado Sugar 1kg', category: 'CATPAN', price: 9600, barcode: '4800001000093', stock: 35 },
  { name: 'Cashew Brittle 150g', category: 'CATSNK', price: 12500, barcode: '4800001000109', stock: 28 },
  { name: 'Tablea Cacao 200g', category: 'CATBEV', price: 21000, barcode: '4800001000116', stock: 20 },
  { name: 'Coconut Vinegar 750ml', category: 'CATPAN', price: 8800, barcode: '4800001000123', stock: 33 },
  { name: 'Abaca Placemat Set', category: 'CATHOM', price: 35000, barcode: '4800001000130', stock: 12 },
  { name: 'Dried Fish Dilis 100g', category: 'CATSNK', price: 7500, barcode: '4800001000147', stock: 41 },
  { name: 'Buko Pandan Mix 3s', category: 'CATPSL', price: 5400, barcode: '4800001000154', stock: 5 },
];

async function demoPinHash(pin: string): Promise<string> {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return argon2id({
    password: pin,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19_456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

async function seedDemoIfEmpty(driver: SqlDriver): Promise<void> {
  const existing = driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM store`);
  if ((existing?.n ?? 0) > 0) return;

  // Hash PINs before opening the tx (argon2 is async; the tx body is sync).
  const staffHashes = await Promise.all(
    DEMO_STAFF.map(async (s) => (s.pin ? await demoPinHash(s.pin) : null)),
  );

  driver.tx(() => {
    driver.run(
      `INSERT INTO store (id, name, currency, timezone, price_mode, sync_rev)
       VALUES (?, 'Bahay Kubo Grocers', 'PHP', 'Asia/Manila', 'tax_inclusive', 1)`,
      [STORE_ID],
    );
    driver.run(`INSERT INTO locations (id, name, sync_rev) VALUES (?, 'Poblacion branch', 1)`, [
      LOCATION_ID,
    ]);
    driver.run(`INSERT INTO roles (id, name, sync_rev) VALUES ('owner', 'Owner', 1), ('cashier', 'Cashier', 1)`);
    DEMO_STAFF.forEach((s, i) => {
      driver.run(
        `INSERT INTO staff (id, name, role_id, pin_hash, active, sync_rev) VALUES (?, ?, ?, ?, ?, 1)`,
        [s.id, s.name, s.roleId, staffHashes[i] ?? null, s.active],
      );
    });
    driver.run(
      `INSERT INTO tax_categories (id, name, sync_rev)
       VALUES (?, 'Standard', 1), ('TAXCEXMP', 'VAT-exempt', 1), ('TAXCZERO', 'Zero-rated', 1)`,
      [TAX_CATEGORY_ID],
    );
    driver.run(
      `INSERT INTO tax_rates (id, tax_category_id, name, rate_bp, sync_rev) VALUES (?, ?, 'VAT 12%', 1200, 1)`,
      [TAX_RATE_ID, TAX_CATEGORY_ID],
    );
    for (const cat of DEMO_CATEGORIES) {
      driver.run(`INSERT INTO categories (id, parent_id, name, sort, sync_rev) VALUES (?, NULL, ?, 0, 1)`, [
        cat.id,
        cat.name,
      ]);
    }
    DEMO_PRODUCTS.forEach((p, i) => {
      const productId = `PROD${String(i).padStart(4, '0')}`;
      const variantId = `VART${String(i).padStart(4, '0')}`;
      driver.run(
        `INSERT INTO products (id, name, category_id, tax_category_id, status, sync_rev)
         VALUES (?, ?, ?, ?, 'active', 1)`,
        [productId, p.name, p.category, TAX_CATEGORY_ID],
      );
      driver.run(
        `INSERT INTO variants (id, product_id, option_values, sku, price_amount, track_stock, sync_rev)
         VALUES (?, ?, '{}', ?, ?, 1, 1)`,
        [variantId, productId, `SKU-${p.barcode.slice(-5)}`, p.price],
      );
      driver.run(`INSERT INTO barcodes (id, variant_id, code, sync_rev) VALUES (?, ?, ?, 1)`, [
        `BARC${String(i).padStart(4, '0')}`,
        variantId,
        p.barcode,
      ]);
      driver.run(
        `INSERT INTO inventory_levels (id, variant_id, location_id, on_hand, sync_rev)
         VALUES (?, ?, ?, ?, 1)`,
        [`INVL${String(i).padStart(4, '0')}`, variantId, LOCATION_ID, p.stock],
      );
    });
  });
}

export const DEMO_LOCATION_ID = LOCATION_ID;

export interface TaxCategoryOption {
  id: string;
  name: string;
  rates: TaxRateRow[];
}

/** Tax categories with their resolved rates — the custom-sale tax picker. */
export function listTaxCategories(driver: SqlDriver): TaxCategoryOption[] {
  const byCat = taxRatesByCategory(driver);
  return driver
    .all<{ id: string; name: string }>(`SELECT id, name FROM tax_categories ORDER BY name`)
    .map((cat) => ({ id: cat.id, name: cat.name, rates: byCat.get(cat.id) ?? [] }));
}
