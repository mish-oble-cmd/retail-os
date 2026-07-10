/**
 * CSV import/export, FR-2.6 Phase 1 subset: valid rows import, invalid rows
 * come back with row number + reason; export re-imports cleanly.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { categories, locations, roles, staff, stores, taxCategories } from '../src/db/schema';
import { ProductImportService } from '../src/modules/catalog/product-import.service';
import { ProductsService } from '../src/modules/catalog/products.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let products: ProductsService;
let importer: ProductImportService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  cashierRole: '01ROLEAAAAAAAAAAAAAAAAAAAC',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  cashier: '01STAFFAAAAAAAAAAAAAAAAAAC',
  taxCategory: '01TAXCATAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAAA',
};

const HEADER =
  'name,category,price,sku,barcode,initial_stock,tax_category,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value';

beforeAll(async () => {
  db = await createTestDb();
  const dbService = { tenants: db.tenants } as unknown as DbService;
  products = new ProductsService(dbService);
  importer = new ProductImportService(dbService, products);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values({ id: A.store, name: 'Store A', currency: 'SGD' });
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: {} },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
    ]);
    await tx.insert(taxCategories).values({ id: A.taxCategory, storeId: A.store, name: 'Standard' });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
    // Categories must pre-exist (approved ADM-03 import mockup: unknown
    // category is a fixable error, never an auto-create).
    await tx.insert(categories).values([
      { id: '01CATAPPARELAAAAAAAAAAAAAA', storeId: A.store, name: 'Apparel' },
      { id: '01CATMERCHAAAAAAAAAAAAAAAA', storeId: A.store, name: 'Merch' },
    ]);
  });
});

afterAll(async () => {
  await db.close();
});

describe('import', () => {
  it('imports valid rows, skips invalid ones with row + reason', async () => {
    const csv = [
      HEADER,
      // rows 2-3: matrix product, two variants
      'Kaya Toast Tee,Apparel,25.00,KTT-S,8880000001010,5,Standard,Size,S,,,,',
      'Kaya Toast Tee,Apparel,25.00,KTT-M,8880000001027,3,Standard,Size,M,,,,',
      // row 4: simple product, no stock, default tax
      'Mug,Merch,12.90,MUG-1,,,,,,,,,',
      // row 5: bad price
      'Broken Price,Merch,twelve,,,,,,,,,,',
      // row 6: missing name
      ',Merch,1.00,,,,,,,,,,',
      // row 7: unknown tax category
      'Ghost Tax,Merch,5.00,,,,Imported VAT,,,,,,',
      // row 8: barcode clashes with row 2
      'Clash,Merch,3.00,,8880000001010,,,,,,,,',
      // row 9: unknown category (mockup contract: error, never auto-create)
      'Ghost Category,Chill Drinks,2.00,,,,,,,,,,',
      // row 10: duplicate SKU within the file (clashes with row 4's MUG-1)
      'Second Mug,Merch,8.00,MUG-1,,,,,,,,,',
    ].join('\n');

    const report = await importer.import(A.store, A.owner, csv);
    expect(report.rows_total).toBe(9);
    expect(report.products_created).toBe(2);
    expect(report.variants_created).toBe(3);
    expect(report.skipped).toEqual([
      { row: 5, reason: expect.stringContaining('price') },
      { row: 6, reason: 'Missing product name' },
      { row: 7, reason: 'Unknown tax category "Imported VAT"' },
      { row: 8, reason: expect.stringContaining('8880000001010') },
      { row: 9, reason: expect.stringContaining(`Category "Chill Drinks" doesn't exist`) },
      { row: 10, reason: 'Duplicate SKU MUG-1 within this file (also on row 4)' },
    ]);

    // The matrix product landed with variants, stock, and the existing category.
    const page = await products.list(A.store, { limit: 50, search: 'Kaya Toast Tee' }, { limit: 50 });
    const tee = page.items.find((p) => p.name === 'Kaya Toast Tee');
    expect(tee?.variant_count).toBe(2);
    expect(tee?.on_hand).toBe(8);
    expect(tee?.category_id).toBe('01CATAPPARELAAAAAAAAAAAAAA');
  });

  it('matches categories by name case-insensitively', async () => {
    const csv = [HEADER, 'Second Shirt,apparel,9.99,,,,Standard,,,,,,'].join('\n');
    const report = await importer.import(A.store, A.owner, csv);
    expect(report.skipped).toEqual([]);
    expect(report.products_created).toBe(1);
    const page = await products.list(A.store, { limit: 50, search: 'Second Shirt' }, { limit: 50 });
    expect(page.items[0]?.category_id).toBe('01CATAPPARELAAAAAAAAAAAAAA');
  });

  it('rejects a wrong header outright', async () => {
    await expect(importer.import(A.store, A.owner, 'foo,bar\n1,2\n')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a cashier with one 403, not row-level noise', async () => {
    const csv = [HEADER, 'Nope,,1.00,,,,,,,,,,'].join('\n');
    await expect(importer.import(A.store, A.cashier, csv)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('export', () => {
  it('produces the import template and re-imports cleanly into a fresh store', async () => {
    const csv = await importer.export(A.store);
    const header = csv.split('\n')[0];
    expect(header).toBe(HEADER);
    expect(csv).toContain('Kaya Toast Tee');
    expect(csv).toContain('KTT-M');

    // Round-trip: a second store imports the export without skips.
    const fresh = {
      store: '01STOREFFFFFFFFFFFFFFFFFFF',
      role: '01ROLEFFFFFFFFFFFFFFFFFFFF',
      owner: '01STAFFFFFFFFFFFFFFFFFFFFF',
      location: '01LOCFFFFFFFFFFFFFFFFFFFFF',
    };
    await db.tenants.dangerouslyCrossTenant('test seed: fresh store', async (tx) => {
      await tx.insert(stores).values({ id: fresh.store, name: 'Fresh', currency: 'SGD' });
      await tx
        .insert(roles)
        .values({ id: fresh.role, storeId: fresh.store, name: 'Owner', permissions: { owner: true } });
      await tx
        .insert(staff)
        .values({ id: fresh.owner, storeId: fresh.store, name: 'Owner F', roleId: fresh.role });
      await tx
        .insert(taxCategories)
        .values({ id: '01TAXCATFFFFFFFFFFFFFFFFFF', storeId: fresh.store, name: 'Standard' });
      await tx.insert(locations).values({ id: fresh.location, storeId: fresh.store, name: 'Main' });
      // Same category names as store A — categories travel by name and must exist first.
      await tx.insert(categories).values([
        { id: '01CATAPPARELFFFFFFFFFFFFFF', storeId: fresh.store, name: 'Apparel' },
        { id: '01CATMERCHFFFFFFFFFFFFFFFF', storeId: fresh.store, name: 'Merch' },
      ]);
    });
    const report = await importer.import(fresh.store, fresh.owner, csv);
    expect(report.skipped).toEqual([]);
    expect(report.products_created).toBeGreaterThanOrEqual(3);
  });
});
