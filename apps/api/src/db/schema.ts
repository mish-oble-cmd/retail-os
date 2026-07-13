import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
  ...syncRev,
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
  ...syncRev,
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
    ...syncRev,
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
  ...syncRev,
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
  ...syncRev,
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
    /** Set when created by the onboarding sample-catalog seed (1E); NULL for real rows. */
    sampleBatchId: text('sample_batch_id'),
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
    /** Set when created by the onboarding sample-catalog seed (1E); NULL for real rows. */
    sampleBatchId: text('sample_batch_id'),
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
    /** Set when created by the onboarding sample-catalog seed (1E); NULL for real rows. */
    sampleBatchId: text('sample_batch_id'),
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
    /** Set when created by the onboarding sample-catalog seed (1E); NULL for real rows. */
    sampleBatchId: text('sample_batch_id'),
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

// ---- Phase 1/1B: sync plumbing + order facts --------------------------------
// (0003_sync.sql; docs: data-model.md §Sync plumbing, offline-sync-strategy.md)

/** Deletions ride the delta feed: AFTER DELETE triggers on ⬇-synced tables write here. */
export const syncTombstones = pgTable(
  'sync_tombstones',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    ...syncRev,
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.entityType, table.entityId] }),
    index('sync_tombstones_store_rev_idx').on(table.storeId, table.syncRev),
  ],
);

/** Activated register devices; only the sha-256 hash of the device token is stored. */
export const devices = pgTable(
  'devices',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    registerId: text('register_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    appVersion: text('app_version'),
    activatedAt: timestamp('activated_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('devices_token_hash_unique').on(table.tokenHash),
    index('devices_store_register_idx').on(table.storeId, table.registerId),
    foreignKey({
      name: 'devices_register_fk',
      columns: [table.storeId, table.registerId],
      foreignColumns: [registers.storeId, registers.id],
    }),
  ],
);

/** Immutable sale facts (invariant 4): only server-set state transitions may UPDATE. */
export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    registerId: text('register_id').notNull(),
    locationId: text('location_id').notNull(),
    staffId: text('staff_id'),
    shiftId: text('shift_id'),
    customerId: text('customer_id'),
    number: text('number').notNull(),
    state: text('state', {
      enum: ['completed', 'partially_paid', 'refunded', 'partially_refunded', 'voided'],
    }).notNull(),
    currency: text('currency').notNull(),
    subtotalAmount: bigint('subtotal_amount', { mode: 'number' }).notNull(),
    discountAmount: bigint('discount_amount', { mode: 'number' }).notNull().default(0),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    taxLines: jsonb('tax_lines').notNull().default([]),
    note: text('note'),
    source: text('source', { enum: ['pos', 'api'] })
      .notNull()
      .default('pos'),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }),
    localSeq: bigint('local_seq', { mode: 'number' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    unique('orders_store_id_unique').on(table.storeId, table.id),
    index('orders_store_created_idx').on(table.storeId, table.clientCreatedAt),
    foreignKey({
      name: 'orders_register_fk',
      columns: [table.storeId, table.registerId],
      foreignColumns: [registers.storeId, registers.id],
    }),
    foreignKey({
      name: 'orders_location_fk',
      columns: [table.storeId, table.locationId],
      foreignColumns: [locations.storeId, locations.id],
    }),
    foreignKey({
      name: 'orders_staff_fk',
      columns: [table.storeId, table.staffId],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    orderId: text('order_id').notNull(),
    variantId: text('variant_id'),
    name: text('name').notNull(),
    qty: bigint('qty', { mode: 'number' }).notNull(),
    unitPriceAmount: bigint('unit_price_amount', { mode: 'number' }).notNull(),
    discounts: jsonb('discounts').notNull().default([]),
    taxLines: jsonb('tax_lines').notNull().default([]),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    costSnapshotAmount: bigint('cost_snapshot_amount', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('order_lines_store_order_idx').on(table.storeId, table.orderId),
    foreignKey({
      name: 'order_lines_order_fk',
      columns: [table.storeId, table.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
    foreignKey({
      name: 'order_lines_variant_fk',
      columns: [table.storeId, table.variantId],
      foreignColumns: [variants.storeId, variants.id],
    }),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    orderId: text('order_id').notNull(),
    tenderType: text('tender_type', { enum: ['cash', 'card_manual'] }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    changeAmount: bigint('change_amount', { mode: 'number' }).notNull().default(0),
    cardRef: text('card_ref'),
    cardLast4: text('card_last4'),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_store_order_idx').on(table.storeId, table.orderId),
    foreignKey({
      name: 'payments_order_fk',
      columns: [table.storeId, table.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    orderId: text('order_id').notNull(),
    staffId: text('staff_id'),
    approvedBy: text('approved_by'),
    currency: text('currency').notNull(),
    totalAmount: bigint('total_amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    taxLines: jsonb('tax_lines').notNull().default([]),
    tenderType: text('tender_type', { enum: ['cash', 'card_manual'] }).notNull(),
    cardRef: text('card_ref'),
    cardLast4: text('card_last4'),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }),
    localSeq: bigint('local_seq', { mode: 'number' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('refunds_store_id_unique').on(table.storeId, table.id),
    index('refunds_store_order_idx').on(table.storeId, table.orderId),
    foreignKey({
      name: 'refunds_order_fk',
      columns: [table.storeId, table.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
    foreignKey({
      name: 'refunds_staff_fk',
      columns: [table.storeId, table.staffId],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);

export const refundLines = pgTable(
  'refund_lines',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    refundId: text('refund_id').notNull(),
    orderLineId: text('order_line_id').notNull(),
    variantId: text('variant_id'),
    qty: bigint('qty', { mode: 'number' }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    restock: boolean('restock').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('refund_lines_store_refund_idx').on(table.storeId, table.refundId),
    foreignKey({
      name: 'refund_lines_refund_fk',
      columns: [table.storeId, table.refundId],
      foreignColumns: [refunds.storeId, refunds.id],
    }),
  ],
);

/** Shift: cash-drawer lifecycle for a register (1D, FR-6.1). Closed rows carry the Z snapshot. */
export const shifts = pgTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    registerId: text('register_id').notNull(),
    locationId: text('location_id').notNull(),
    openedByStaffId: text('opened_by_staff_id'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    openingFloat: bigint('opening_float', { mode: 'number' }).notNull(),
    closedByStaffId: text('closed_by_staff_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closingCounted: bigint('closing_counted', { mode: 'number' }),
    closingExpected: bigint('closing_expected', { mode: 'number' }),
    overShort: bigint('over_short', { mode: 'number' }),
    zSnapshot: jsonb('z_snapshot'),
    state: text('state', { enum: ['open', 'closed'] })
      .notNull()
      .default('open'),
    localSeq: bigint('local_seq', { mode: 'number' }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('shifts_store_id_unique').on(table.storeId, table.id),
    index('shifts_store_register_idx').on(table.storeId, table.registerId),
    foreignKey({
      name: 'shifts_register_fk',
      columns: [table.storeId, table.registerId],
      foreignColumns: [registers.storeId, registers.id],
    }),
    foreignKey({
      name: 'shifts_opened_by_fk',
      columns: [table.storeId, table.openedByStaffId],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);

/** Cash movement: paid in/out and no-sale drawer opens (1D, FR-6.1). Append-only. */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    shiftId: text('shift_id').notNull(),
    kind: text('kind', { enum: ['paid_in', 'paid_out', 'no_sale'] }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull().default(0),
    reason: text('reason').notNull().default(''),
    staffId: text('staff_id'),
    approvedByStaffId: text('approved_by_staff_id'),
    clientCreatedAt: timestamp('client_created_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cash_movements_store_shift_idx').on(table.storeId, table.shiftId),
    foreignKey({
      name: 'cash_movements_shift_fk',
      columns: [table.storeId, table.shiftId],
      foreignColumns: [shifts.storeId, shifts.id],
    }),
  ],
);

/** Batch idempotency: PK (store_id, batch ULID); acks are replayed verbatim on duplicates. */
export const syncBatches = pgTable(
  'sync_batches',
  {
    id: text('id').notNull(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    registerId: text('register_id').notNull(),
    deviceId: text('device_id').notNull(),
    factCount: integer('fact_count').notNull(),
    acks: jsonb('acks').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.storeId, table.id] }),
    foreignKey({
      name: 'sync_batches_register_fk',
      columns: [table.storeId, table.registerId],
      foreignColumns: [registers.storeId, registers.id],
    }),
  ],
);

/** Ingest divergences (golden rule: the sale is accepted, the human sees the delta). */
export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: text('id').primaryKey(),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    conflictType: text('conflict_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (table) => [
    foreignKey({
      name: 'sync_conflicts_staff_fk',
      columns: [table.storeId, table.resolvedBy],
      foreignColumns: [staff.storeId, staff.id],
    }),
  ],
);
