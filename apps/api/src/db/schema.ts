import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Phase 0 tables (phase-0-foundations.md §0.4): Store, Staff (+Role), Location,
 * Register. Phase 1/1A adds the catalog + inventory-ledger tables. Conventions
 * per data-model.md: ULID text PKs, store_id on every business table,
 * timestamps. RLS policies live in the SQL migrations.
 *
 * `sync_rev` on ⬇-synced tables is server-assigned per store by the
 * bump_sync_rev trigger (see 0001_catalog.sql) — app code never writes it.
 *
 * Intra-tenant FKs are composite (store_id, id): Postgres RI checks bypass
 * RLS, so single-column FKs would allow cross-tenant references
 * (data-model.md §Global conventions).
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

const syncRev = {
  syncRev: bigint('sync_rev', { mode: 'number' }).notNull().default(0),
};

export const stores = pgTable('stores', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull(),
  timezone: text('timezone').notNull().default('Asia/Manila'),
  priceMode: text('price_mode', { enum: ['tax_inclusive', 'tax_exclusive'] })
    .notNull()
    .default('tax_inclusive'),
  plan: text('plan').notNull().default('free'),
  settings: jsonb('settings').notNull().default({}),
  /** Monotonic per-store revision counter feeding sync_rev (bump_sync_rev trigger). */
  syncSeq: bigint('sync_seq', { mode: 'number' }).notNull().default(0),
  ...timestamps,
});

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  /** permission flags per FR-5.2, e.g. { "owner": true, "max_discount_pct": 100 } */
  permissions: jsonb('permissions').notNull().default({}),
  ...timestamps,
});

export const staff = pgTable(
  'staff',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    email: text('email'),
    /** argon2id; back-office users only — never synced to POS (data-model.md) */
    passwordHash: text('password_hash'),
    pinHash: text('pin_hash'),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    /** TOTP optional in Phase 0; enforced for Owner from Phase 1 */
    totpSecret: text('totp_secret'),
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    active: boolean('active').notNull().default(true),
    ...timestamps,
  },
  (table) => [uniqueIndex('staff_store_email_unique').on(table.storeId, table.email)],
);

export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  name: text('name').notNull(),
  address: jsonb('address'),
  timezone: text('timezone').notNull().default('Asia/Manila'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const registers = pgTable('registers', {
  id: text('id').primaryKey(),
  storeId: text('store_id')
    .notNull()
    .references(() => stores.id),
  locationId: text('location_id')
    .notNull()
    .references(() => locations.id),
  name: text('name').notNull(),
  gridLayout: jsonb('grid_layout').notNull().default({}),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

/** One-time register activation codes (ADM-16); only the sha-256 hash is stored. */
export const activationCodes = pgTable(
  'activation_codes',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    registerId: text('register_id').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdBy: text('created_by'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('activation_codes_store_hash_unique').on(table.storeId, table.codeHash),
    index('activation_codes_store_register_idx').on(table.storeId, table.registerId),
    foreignKey({
      name: 'activation_codes_register_fk',
      columns: [table.storeId, table.registerId],
      foreignColumns: [registers.storeId, registers.id],
    }),
    foreignKey({
      name: 'activation_codes_staff_fk',
      columns: [table.storeId, table.createdBy],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);

// ---- Phase 1/1A: settings (tax) + catalog + inventory ledger ---------------

export const taxCategories = pgTable(
  'tax_categories',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    ...syncRev,
    ...timestamps,
  },
  (table) => [unique('tax_categories_store_id_unique').on(table.storeId, table.id)],
);

export const taxRates = pgTable(
  'tax_rates',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    taxCategoryId: text('tax_category_id').notNull(),
    name: text('name').notNull(),
    /** Integer basis points (9% GST = 900) — all tax math is integer-only (data-model.md §Tax). */
    rateBp: integer('rate_bp').notNull(),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    index('tax_rates_store_category_idx').on(table.storeId, table.taxCategoryId),
    foreignKey({
      name: 'tax_rates_category_fk',
      columns: [table.storeId, table.taxCategoryId],
      foreignColumns: [taxCategories.storeId, taxCategories.id],
    }),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    index('categories_store_parent_idx').on(table.storeId, table.parentId),
    unique('categories_store_id_unique').on(table.storeId, table.id),
    foreignKey({
      name: 'categories_parent_fk',
      columns: [table.storeId, table.parentId],
      foreignColumns: [table.storeId, table.id],
    }),
  ],
);

export const products = pgTable(
  'products',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: text('category_id'),
    brand: text('brand'),
    /** Ordered image URLs (object storage keys resolved at the edge). */
    images: jsonb('images').notNull().default([]),
    /** Ordered option definitions, e.g. [{"name":"Size","values":["S","M","L"]}] (data-model.md). */
    options: jsonb('options').notNull().default([]),
    taxCategoryId: text('tax_category_id').notNull(),
    status: text('status', { enum: ['active', 'draft', 'archived'] })
      .notNull()
      .default('active'),
    hasVariants: boolean('has_variants').notNull().default(false),
    custom: jsonb('custom').notNull().default({}),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    index('products_store_status_idx').on(table.storeId, table.status),
    unique('products_store_id_unique').on(table.storeId, table.id),
    foreignKey({
      name: 'products_category_fk',
      columns: [table.storeId, table.categoryId],
      foreignColumns: [categories.storeId, categories.id],
    }),
    foreignKey({
      name: 'products_tax_category_fk',
      columns: [table.storeId, table.taxCategoryId],
      foreignColumns: [taxCategories.storeId, taxCategories.id],
    }),
  ],
);

export const variants = pgTable(
  'variants',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    productId: text('product_id').notNull(),
    /** Chosen combination keyed by option name, e.g. {"Size":"M","Color":"Black"}. */
    optionValues: jsonb('option_values').notNull().default({}),
    sku: text('sku'),
    priceAmount: bigint('price_amount', { mode: 'number' }).notNull(),
    compareAtAmount: bigint('compare_at_amount', { mode: 'number' }),
    costAmount: bigint('cost_amount', { mode: 'number' }),
    trackStock: boolean('track_stock').notNull().default(true),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    index('variants_store_product_idx').on(table.storeId, table.productId),
    unique('variants_store_id_unique').on(table.storeId, table.id),
    foreignKey({
      name: 'variants_product_fk',
      columns: [table.storeId, table.productId],
      foreignColumns: [products.storeId, products.id],
    }),
  ],
);

export const barcodes = pgTable(
  'barcodes',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    variantId: text('variant_id').notNull(),
    code: text('code').notNull(),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    uniqueIndex('barcodes_store_code_unique').on(table.storeId, table.code),
    index('barcodes_store_variant_idx').on(table.storeId, table.variantId),
    foreignKey({
      name: 'barcodes_variant_fk',
      columns: [table.storeId, table.variantId],
      foreignColumns: [variants.storeId, variants.id],
    }),
  ],
);

/** Projection of stock_movements (invariant #3, data-model.md) — synced down display-only. */
export const inventoryLevels = pgTable(
  'inventory_levels',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    onHand: bigint('on_hand', { mode: 'number' }).notNull().default(0),
    reorderPoint: bigint('reorder_point', { mode: 'number' }),
    reorderQty: bigint('reorder_qty', { mode: 'number' }),
    ...syncRev,
    ...timestamps,
  },
  (table) => [
    uniqueIndex('inventory_levels_store_variant_location_unique').on(
      table.storeId,
      table.variantId,
      table.locationId,
    ),
    foreignKey({
      name: 'inventory_levels_variant_fk',
      columns: [table.storeId, table.variantId],
      foreignColumns: [variants.storeId, variants.id],
    }),
    foreignKey({
      name: 'inventory_levels_location_fk',
      columns: [table.storeId, table.locationId],
      foreignColumns: [locations.storeId, locations.id],
    }),
  ],
);

/** Immutable ledger (FR-3.1): retailos_app has no UPDATE/DELETE grant — corrections append. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    variantId: text('variant_id').notNull(),
    locationId: text('location_id').notNull(),
    qtyDelta: bigint('qty_delta', { mode: 'number' }).notNull(),
    movementType: text('movement_type', {
      enum: ['sale', 'refund_restock', 'adjustment', 'receive', 'transfer_out', 'transfer_in', 'count'],
    }).notNull(),
    reason: text('reason'),
    refType: text('ref_type'),
    refId: text('ref_id'),
    staffId: text('staff_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_movements_store_variant_location_idx').on(
      table.storeId,
      table.variantId,
      table.locationId,
      table.createdAt,
    ),
    foreignKey({
      name: 'stock_movements_variant_fk',
      columns: [table.storeId, table.variantId],
      foreignColumns: [variants.storeId, variants.id],
    }),
    foreignKey({
      name: 'stock_movements_location_fk',
      columns: [table.storeId, table.locationId],
      foreignColumns: [locations.storeId, locations.id],
    }),
    foreignKey({
      name: 'stock_movements_staff_fk',
      columns: [table.storeId, table.staffId],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);
