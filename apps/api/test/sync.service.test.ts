/**
 * Sync surface (1B): bootstrap snapshot, delta feed with tombstones and
 * paging, batch ingest with idempotent replay + domain revalidation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import {
  barcodes,
  categories,
  inventoryLevels,
  locations,
  products,
  registers,
  roles,
  staff,
  stores,
  taxCategories,
  taxRates,
  variants,
} from '../src/db/schema';
import type { DeviceContext } from '../src/modules/sync/devices.service';
import { SyncService } from '../src/modules/sync/sync.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let syncService: SyncService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  role: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  staff: '01STAFFAAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAA1',
  register: '01REGAAAAAAAAAAAAAAAAAAAA1',
  taxCategory: '01TAXCAAAAAAAAAAAAAAAAAAA1',
  taxRate: '01TAXRAAAAAAAAAAAAAAAAAAA1',
  category: '01CATAAAAAAAAAAAAAAAAAAAA1',
  product: '01PRODAAAAAAAAAAAAAAAAAAA1',
  variant: '01VARAAAAAAAAAAAAAAAAAAAA1',
  barcode: '01BARAAAAAAAAAAAAAAAAAAAA1',
  level: '01LVLAAAAAAAAAAAAAAAAAAAA1',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  taxCategory: '01TAXCBBBBBBBBBBBBBBBBBBB1',
  product: '01PRODBBBBBBBBBBBBBBBBBBB1',
};

const ctx: DeviceContext = {
  deviceId: '01DEVAAAAAAAAAAAAAAAAAAAA1',
  storeId: A.store,
  registerId: A.register,
  locationId: A.location,
};

beforeAll(async () => {
  db = await createTestDb();
  syncService = new SyncService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values([
      { id: A.store, name: 'Store A', currency: 'SGD', timezone: 'Asia/Singapore' },
      { id: B.store, name: 'Store B', currency: 'SGD' },
    ]);
    await tx.insert(roles).values({
      id: A.role,
      storeId: A.store,
      name: 'Owner',
      permissions: { owner: true },
    });
    await tx.insert(staff).values({
      id: A.staff,
      storeId: A.store,
      name: 'Owner A',
      roleId: A.role,
      passwordHash: 'argon2id$SECRET-NEVER-SYNCS',
      pinHash: 'argon2id$pin',
      totpSecret: 'TOTP-SECRET-NEVER-SYNCS',
    });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
    await tx.insert(registers).values({
      id: A.register,
      storeId: A.store,
      locationId: A.location,
      name: 'Front',
      gridLayout: { tiles: [] },
    });
    await tx.insert(taxCategories).values([
      { id: A.taxCategory, storeId: A.store, name: 'Standard' },
      { id: B.taxCategory, storeId: B.store, name: 'Standard' },
    ]);
    await tx.insert(taxRates).values({
      id: A.taxRate,
      storeId: A.store,
      taxCategoryId: A.taxCategory,
      name: 'GST 9%',
      rateBp: 900,
    });
    await tx.insert(categories).values({ id: A.category, storeId: A.store, name: 'Drinks' });
    await tx.insert(products).values([
      {
        id: A.product,
        storeId: A.store,
        name: 'Kopi',
        categoryId: A.category,
        taxCategoryId: A.taxCategory,
        status: 'active',
      },
      // other tenant noise — must never appear in store A's feed
      {
        id: B.product,
        storeId: B.store,
        name: 'Other Store Secret',
        taxCategoryId: B.taxCategory,
        status: 'active',
      },
    ]);
    await tx.insert(variants).values({
      id: A.variant,
      storeId: A.store,
      productId: A.product,
      priceAmount: 250,
    });
    await tx.insert(barcodes).values({ id: A.barcode, storeId: A.store, variantId: A.variant, code: '888000111' });
    await tx.insert(inventoryLevels).values({
      id: A.level,
      storeId: A.store,
      variantId: A.variant,
      locationId: A.location,
      onHand: 100,
    });
  });
});

afterAll(async () => {
  await db.close();
});

describe('SyncService.bootstrap', () => {
  it('returns a consistent snapshot of every down-synced entity', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    expect(snapshot.rev).toBeGreaterThan(0);
    expect(snapshot.store).toMatchObject({ id: A.store, currency: 'SGD', price_mode: 'tax_inclusive' });
    expect(snapshot.data.roles.map((r) => r.id)).toEqual([A.role]);
    expect(snapshot.data.staff.map((s) => s.id)).toEqual([A.staff]);
    expect(snapshot.data.locations.map((l) => l.id)).toEqual([A.location]);
    expect(snapshot.data.registers.map((r) => r.id)).toEqual([A.register]);
    expect(snapshot.data.tax_categories.map((t) => t.id)).toEqual([A.taxCategory]);
    expect(snapshot.data.tax_rates[0]).toMatchObject({ id: A.taxRate, rate_bp: 900 });
    expect(snapshot.data.categories.map((c) => c.id)).toEqual([A.category]);
    expect(snapshot.data.products.map((p) => p.id)).toEqual([A.product]);
    expect(snapshot.data.variants[0]).toMatchObject({ id: A.variant, price_amount: 250 });
    expect(snapshot.data.barcodes[0]).toMatchObject({ id: A.barcode, code: '888000111' });
    expect(snapshot.data.inventory_levels[0]).toMatchObject({ id: A.level, on_hand: 100 });

    // rev covers every row in the snapshot
    const maxRowRev = Math.max(
      ...Object.values(snapshot.data).flatMap((rows) => rows.map((row) => Number(row.sync_rev))),
    );
    expect(snapshot.rev).toBeGreaterThanOrEqual(maxRowRev);
  });

  it('staff sync down is a projection: pin_hash yes, secrets no', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    const staffRow = snapshot.data.staff[0] as Record<string, unknown>;
    expect(staffRow['pin_hash']).toBe('argon2id$pin');
    expect(staffRow).not.toHaveProperty('password_hash');
    expect(staffRow).not.toHaveProperty('totp_secret');
    expect(staffRow).not.toHaveProperty('email');
    expect(JSON.stringify(snapshot)).not.toContain('SECRET-NEVER-SYNCS');
  });

  it('never leaks another tenant', async () => {
    const snapshot = await syncService.bootstrap(ctx);
    expect(JSON.stringify(snapshot)).not.toContain(B.product);
    expect(JSON.stringify(snapshot)).not.toContain('Other Store Secret');
  });
});
