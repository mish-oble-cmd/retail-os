import { z } from 'zod';

/** Input validation at the edge — settings module (locations, registers, ADM-16). */

export const ulidSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID expected');

export const createLocationSchema = z.object({
  name: z.string().min(1).max(120),
  address: z
    .object({
      line1: z.string().max(200).optional(),
      line2: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      postal_code: z.string().max(20).optional(),
      country: z.string().max(60).optional(),
    })
    .optional(),
  /** Defaults to the store timezone. */
  timezone: z.string().max(60).optional(),
});

export const updateLocationSchema = createLocationSchema
  .extend({ active: z.boolean() })
  .partial();

/** POS-03 tile grid (ADM-16 designer). References are soft — POS tolerates a deleted product. */
const gridTileSchema = z.object({
  row: z.number().int().min(0).max(50),
  col: z.number().int().min(0).max(50),
  kind: z.enum(['product', 'category']),
  ref_id: ulidSchema,
  label: z.string().max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

export const gridLayoutSchema = z.object({
  columns: z.number().int().min(2).max(12).default(4),
  tiles: z.array(gridTileSchema).max(400).default([]),
});

export const createRegisterSchema = z.object({
  location_id: ulidSchema,
  name: z.string().min(1).max(120),
});

export const updateRegisterSchema = z.object({
  name: z.string().min(1).max(120),
  active: z.boolean(),
  grid_layout: gridLayoutSchema,
}).partial();

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type CreateRegisterInput = z.infer<typeof createRegisterSchema>;
export type UpdateRegisterInput = z.infer<typeof updateRegisterSchema>;
