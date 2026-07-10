import { z } from 'zod';

/** Request schemas for the sync surface (api-design.md §/sync). */

export const activateDeviceSchema = z.object({
  /** 8-char Crockford base32; tolerate a display hyphen (ABCD-EFGH). */
  code: z
    .string()
    .transform((value) => value.replace(/-/g, '').trim().toUpperCase())
    .pipe(z.string().length(8)),
  app_version: z.string().max(50).optional(),
});
export type ActivateDeviceInput = z.infer<typeof activateDeviceSchema>;
