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
