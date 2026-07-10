import { z } from 'zod';

/** Input validation at the edge — zod schemas for the catalog module. */

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID expected');

export const createCategorySchema = z.object({
  name: z.string().min(1).max(120),
  parent_id: ulidSchema.nullish(),
  sort: z.number().int().min(0).max(1_000_000).optional(),
});

export const updateCategorySchema = createCategorySchema.partial();

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---- Products / variants / barcodes (FR-2.1, FR-2.2 basic) -----------------

/**
 * Money rides as { amount, currency } (api-design.md §Conventions); amount is
 * integer minor units — never floats (CLAUDE.md rule 5). currency is optional
 * on input and validated against the store currency when present.
 */
export const moneySchema = z.object({
  amount: z.number().int().min(0).max(1_000_000_000_000),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. SGD')
    .optional(),
});

const optionSchema = z.object({
  name: z.string().min(1).max(40),
  values: z.array(z.string().min(1).max(60)).min(1).max(100),
});

export const variantInputSchema = z.object({
  option_values: z.record(z.string().min(1).max(60)).default({}),
  sku: z.string().min(1).max(64).nullish(),
  barcodes: z.array(z.string().min(3).max(64)).max(10).default([]),
  price: moneySchema,
  compare_at_price: moneySchema.nullish(),
  cost: moneySchema.nullish(),
  track_stock: z.boolean().default(true),
  /** Sets the opening on-hand at the store's (Phase 1: single) location. */
  initial_stock: z.number().int().min(0).max(1_000_000_000).optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullish(),
  category_id: ulidSchema.nullish(),
  brand: z.string().max(100).nullish(),
  status: z.enum(['active', 'draft', 'archived']).default('active'),
  /** Defaults to the store's oldest tax category (Phase 1 stores have one, "Standard"). */
  tax_category_id: ulidSchema.optional(),
  /** Up to 3 options (FR-2.2); empty = simple product with exactly one variant. */
  options: z.array(optionSchema).max(3).default([]),
  variants: z.array(variantInputSchema).min(1).max(250),
});

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).nullable(),
  category_id: ulidSchema.nullable(),
  brand: z.string().max(100).nullable(),
  status: z.enum(['active', 'draft', 'archived']),
  tax_category_id: ulidSchema,
}).partial();

export const createVariantSchema = variantInputSchema;

export const updateVariantSchema = z.object({
  sku: z.string().min(1).max(64).nullable(),
  /** Full replacement of the variant's barcode set. */
  barcodes: z.array(z.string().min(3).max(64)).max(10),
  price: moneySchema,
  compare_at_price: moneySchema.nullable(),
  cost: moneySchema.nullable(),
  track_stock: z.boolean(),
}).partial();

export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  /** Matches product name (contains), variant SKU (contains), or barcode (exact). */
  search: z.string().min(1).max(120).optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  category_id: ulidSchema.optional(),
});

export type VariantInput = z.infer<typeof variantInputSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
