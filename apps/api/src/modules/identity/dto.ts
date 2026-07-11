import { z } from 'zod';

/** Input validation at the edge (security-and-compliance.md) — zod schemas. */

export const signupSchema = z.object({
  email: z.string().email().max(254),
  // NIST-style: length over composition rules; breached-password check Phase 1.
  password: z.string().min(10).max(128),
  store_name: z.string().min(1).max(120),
  currency: z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 code, e.g. PHP'),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
  totp_code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const totpActivateSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'ULID expected');

export const createStaffSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(320).optional(),
  role_id: ulidSchema,
});
export type CreateStaffInput = z.infer<typeof createStaffSchema>;

export const updateStaffSchema = z
  .object({
    name: z.string().min(1).max(120),
    role_id: ulidSchema,
    active: z.boolean(),
  })
  .partial();
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

export const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4-6 digits'),
});
