import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { stores } from '../../db/schema';
import type { UpdateStoreInput } from './dto';

export interface StoreProfileResource {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  price_mode: 'tax_inclusive' | 'tax_exclusive';
}

/**
 * Store-profile updates (1E onboarding step 2 + ADM-17). RLS pins the
 * transaction to the caller's store, so the WHERE on id is belt-and-braces.
 */
@Injectable()
export class StoreService {
  constructor(private readonly db: DbService) {}

  async update(storeId: string, input: UpdateStoreInput): Promise<StoreProfileResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (input.price_mode !== undefined) patch.priceMode = input.price_mode;
      const rows = await tx
        .update(stores)
        .set(patch)
        .where(eq(stores.id, storeId))
        .returning({
          id: stores.id,
          name: stores.name,
          currency: stores.currency,
          timezone: stores.timezone,
          priceMode: stores.priceMode,
        });
      const s = rows[0]!;
      return {
        id: s.id,
        name: s.name,
        currency: s.currency,
        timezone: s.timezone,
        price_mode: s.priceMode,
      };
    });
  }
}
