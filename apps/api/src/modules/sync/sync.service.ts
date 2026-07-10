import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
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
  syncTombstones,
  taxCategories,
  taxRates,
  variants,
} from '../../db/schema';
import type { DeviceContext } from './devices.service';

/**
 * Down-sync surface (offline-sync-strategy.md): bootstrap snapshot + delta
 * feed by per-store sync_rev. Rows go out as snake_case JSON of the table
 * columns minus tenancy/audit noise, keeping sync_rev so the client can
 * reason about what it holds.
 */

type Row = Record<string, unknown>;

export interface BootstrapSnapshot {
  /** stores.sync_seq at snapshot time — same tx as the reads, so it covers them. */
  rev: number;
  store: Row;
  data: {
    roles: Row[];
    staff: Row[];
    locations: Row[];
    registers: Row[];
    tax_categories: Row[];
    tax_rates: Row[];
    categories: Row[];
    products: Row[];
    variants: Row[];
    barcodes: Row[];
    inventory_levels: Row[];
  };
}

const storeDown = (row: typeof stores.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  currency: row.currency,
  timezone: row.timezone,
  price_mode: row.priceMode,
  settings: row.settings,
  sync_rev: row.syncRev,
});

const roleDown = (row: typeof roles.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  permissions: row.permissions,
  sync_rev: row.syncRev,
});

/** Projection, not the row: pin_hash only — password/TOTP material never syncs down. */
const staffDown = (row: {
  id: string;
  name: string;
  roleId: string;
  pinHash: string | null;
  active: boolean;
  syncRev: number;
}): Row => ({
  id: row.id,
  name: row.name,
  role_id: row.roleId,
  pin_hash: row.pinHash,
  active: row.active,
  sync_rev: row.syncRev,
});

const locationDown = (row: typeof locations.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  active: row.active,
  sync_rev: row.syncRev,
});

const registerDown = (row: typeof registers.$inferSelect): Row => ({
  id: row.id,
  location_id: row.locationId,
  name: row.name,
  grid_layout: row.gridLayout,
  active: row.active,
  sync_rev: row.syncRev,
});

const taxCategoryDown = (row: typeof taxCategories.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  sync_rev: row.syncRev,
});

const taxRateDown = (row: typeof taxRates.$inferSelect): Row => ({
  id: row.id,
  tax_category_id: row.taxCategoryId,
  name: row.name,
  rate_bp: row.rateBp,
  sync_rev: row.syncRev,
});

const categoryDown = (row: typeof categories.$inferSelect): Row => ({
  id: row.id,
  parent_id: row.parentId,
  name: row.name,
  sort: row.sort,
  sync_rev: row.syncRev,
});

const productDown = (row: typeof products.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category_id: row.categoryId,
  brand: row.brand,
  images: row.images,
  options: row.options,
  tax_category_id: row.taxCategoryId,
  status: row.status,
  has_variants: row.hasVariants,
  custom: row.custom,
  sync_rev: row.syncRev,
});

const variantDown = (row: typeof variants.$inferSelect): Row => ({
  id: row.id,
  product_id: row.productId,
  option_values: row.optionValues,
  sku: row.sku,
  price_amount: row.priceAmount,
  compare_at_amount: row.compareAtAmount,
  cost_amount: row.costAmount,
  track_stock: row.trackStock,
  sync_rev: row.syncRev,
});

const barcodeDown = (row: typeof barcodes.$inferSelect): Row => ({
  id: row.id,
  variant_id: row.variantId,
  code: row.code,
  sync_rev: row.syncRev,
});

const inventoryLevelDown = (row: typeof inventoryLevels.$inferSelect): Row => ({
  id: row.id,
  variant_id: row.variantId,
  location_id: row.locationId,
  on_hand: row.onHand,
  reorder_point: row.reorderPoint,
  reorder_qty: row.reorderQty,
  sync_rev: row.syncRev,
});

const STAFF_PROJECTION = {
  id: staff.id,
  name: staff.name,
  roleId: staff.roleId,
  pinHash: staff.pinHash,
  active: staff.active,
  syncRev: staff.syncRev,
};

export type DownEntityType =
  | 'store'
  | 'role'
  | 'staff'
  | 'location'
  | 'register'
  | 'tax_category'
  | 'tax_rate'
  | 'category'
  | 'product'
  | 'variant'
  | 'barcode'
  | 'inventory_level'
  | 'tombstone';

export interface Change {
  type: DownEntityType;
  rev: number;
  data: Row;
}

export interface ChangesPage {
  /** ascending by rev */
  changes: Change[];
  /** resume cursor: last rev in the page, or the request's `since` when empty */
  next_since: number;
  has_more: boolean;
}

@Injectable()
export class SyncService {
  constructor(private readonly db: DbService) {}

  async bootstrap(ctx: DeviceContext): Promise<BootstrapSnapshot> {
    return this.db.tenants.forStore(ctx.storeId).tx(async (tx) => {
      const [storeRow] = await tx.select().from(stores).where(eq(stores.id, ctx.storeId));
      if (!storeRow) throw new Error(`bootstrap: store ${ctx.storeId} not visible`);
      return {
        rev: storeRow.syncSeq,
        store: storeDown(storeRow),
        data: {
          roles: (await tx.select().from(roles)).map(roleDown),
          staff: (await tx.select(STAFF_PROJECTION).from(staff)).map(staffDown),
          locations: (await tx.select().from(locations)).map(locationDown),
          registers: (await tx.select().from(registers)).map(registerDown),
          tax_categories: (await tx.select().from(taxCategories)).map(taxCategoryDown),
          tax_rates: (await tx.select().from(taxRates)).map(taxRateDown),
          categories: (await tx.select().from(categories)).map(categoryDown),
          products: (await tx.select().from(products)).map(productDown),
          variants: (await tx.select().from(variants)).map(variantDown),
          barcodes: (await tx.select().from(barcodes)).map(barcodeDown),
          inventory_levels: (await tx.select().from(inventoryLevels)).map(inventoryLevelDown),
        },
      };
    });
  }

  /**
   * Delta feed: everything above `since`, merged across tables, ascending by
   * rev. Each table is read with limit+1 so has_more never lies even when a
   * single table fills the page.
   */
  async changes(ctx: DeviceContext, since: number, limit = 500): Promise<ChangesPage> {
    const cap = Math.min(Math.max(limit, 1), 500);
    return this.db.tenants.forStore(ctx.storeId).tx(async (tx) => {
      const probe = cap + 1;
      const merged: Change[] = [];

      const collect = async <T extends { syncRev: number }>(
        type: DownEntityType,
        rows: Promise<T[]>,
        map: (row: T) => Row,
      ) => {
        for (const row of await rows) merged.push({ type, rev: row.syncRev, data: map(row) });
      };

      await collect(
        'store',
        tx.select().from(stores).where(and(eq(stores.id, ctx.storeId), gt(stores.syncRev, since))),
        storeDown,
      );
      await collect(
        'role',
        tx.select().from(roles).where(gt(roles.syncRev, since)).orderBy(asc(roles.syncRev)).limit(probe),
        roleDown,
      );
      await collect(
        'staff',
        tx.select(STAFF_PROJECTION).from(staff).where(gt(staff.syncRev, since)).orderBy(asc(staff.syncRev)).limit(probe),
        staffDown,
      );
      await collect(
        'location',
        tx.select().from(locations).where(gt(locations.syncRev, since)).orderBy(asc(locations.syncRev)).limit(probe),
        locationDown,
      );
      await collect(
        'register',
        tx.select().from(registers).where(gt(registers.syncRev, since)).orderBy(asc(registers.syncRev)).limit(probe),
        registerDown,
      );
      await collect(
        'tax_category',
        tx
          .select()
          .from(taxCategories)
          .where(gt(taxCategories.syncRev, since))
          .orderBy(asc(taxCategories.syncRev))
          .limit(probe),
        taxCategoryDown,
      );
      await collect(
        'tax_rate',
        tx.select().from(taxRates).where(gt(taxRates.syncRev, since)).orderBy(asc(taxRates.syncRev)).limit(probe),
        taxRateDown,
      );
      await collect(
        'category',
        tx.select().from(categories).where(gt(categories.syncRev, since)).orderBy(asc(categories.syncRev)).limit(probe),
        categoryDown,
      );
      await collect(
        'product',
        tx.select().from(products).where(gt(products.syncRev, since)).orderBy(asc(products.syncRev)).limit(probe),
        productDown,
      );
      await collect(
        'variant',
        tx.select().from(variants).where(gt(variants.syncRev, since)).orderBy(asc(variants.syncRev)).limit(probe),
        variantDown,
      );
      await collect(
        'barcode',
        tx.select().from(barcodes).where(gt(barcodes.syncRev, since)).orderBy(asc(barcodes.syncRev)).limit(probe),
        barcodeDown,
      );
      await collect(
        'inventory_level',
        tx
          .select()
          .from(inventoryLevels)
          .where(gt(inventoryLevels.syncRev, since))
          .orderBy(asc(inventoryLevels.syncRev))
          .limit(probe),
        inventoryLevelDown,
      );
      await collect(
        'tombstone',
        tx
          .select()
          .from(syncTombstones)
          .where(gt(syncTombstones.syncRev, since))
          .orderBy(asc(syncTombstones.syncRev))
          .limit(probe),
        (row) => ({ entity_type: row.entityType, entity_id: row.entityId, sync_rev: row.syncRev }),
      );

      merged.sort((a, b) => a.rev - b.rev);
      const page = merged.slice(0, cap);
      const last = page[page.length - 1];
      return {
        changes: page,
        next_since: last ? last.rev : since,
        has_more: merged.length > cap,
      };
    });
  }
}
