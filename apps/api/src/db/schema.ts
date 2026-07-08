import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Phase 0 tables (phase-0-foundations.md §0.4): Store, Staff (+Role), Location,
 * Register. Conventions per data-model.md: ULID text PKs, store_id on every
 * business table, timestamps. RLS policies live in the SQL migration.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
