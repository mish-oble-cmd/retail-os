import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
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
}
