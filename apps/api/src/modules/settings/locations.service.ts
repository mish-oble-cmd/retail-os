import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { DbService } from '../../db/db.service';
import { locations, stores } from '../../db/schema';
import type { CreateLocationInput, UpdateLocationInput } from './dto';

export interface LocationResource {
  id: string;
  name: string;
  address: Record<string, string> | null;
  timezone: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function toResource(row: typeof locations.$inferSelect): LocationResource {
  return {
    id: row.id,
    name: row.name,
    // why cast: address JSONB is validated by zod on every write.
    address: row.address as Record<string, string> | null,
    timezone: row.timezone,
    active: row.active,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LocationsService {
  constructor(private readonly db: DbService) {}

  async list(storeId: string): Promise<LocationResource[]> {
    const rows = await this.db.tenants
      .forStore(storeId)
      .tx((tx) => tx.select().from(locations).orderBy(asc(locations.id)));
    return rows.map(toResource);
  }

  async create(storeId: string, staffId: string, input: CreateLocationInput): Promise<LocationResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const store = await tx.select({ timezone: stores.timezone }).from(stores);
      const rows = await tx
        .insert(locations)
        .values({
          id: ulid(),
          storeId,
          name: input.name,
          address: input.address ?? null,
          // why non-null: RLS pins the transaction to exactly one store row.
          timezone: input.timezone ?? store[0]!.timezone,
        })
        .returning();
      return toResource(rows[0]!);
    });
  }

  async update(storeId: string, staffId: string, id: string, input: UpdateLocationInput): Promise<LocationResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const rows = await tx
        .update(locations)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(locations.id, id))
        .returning();
      const row = rows[0];
      if (!row) throw new NotFoundException('Location not found');
      return toResource(row);
    });
  }
}
