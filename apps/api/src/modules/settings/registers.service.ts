import { createHash, randomInt } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { DbService, type TenantTx } from '../../db/db.service';
import { activationCodes, locations, registers } from '../../db/schema';
import type { CreateRegisterInput, UpdateRegisterInput } from './dto';

/** Crockford base32 — no I/L/O/U, so codes survive being read over the phone. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 24 * 60 * 60 * 1000;

export function hashActivationCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface RegisterResource {
  id: string;
  location_id: string;
  name: string;
  active: boolean;
  grid_layout: unknown;
  /** Pending (unused, unexpired) activation code — expiry only; the code itself is never re-shown. */
  pending_activation: { expires_at: string } | null;
  created_at: string;
  updated_at: string;
}

export interface IssuedActivationCode {
  /** Shown exactly once — only the hash is stored. */
  code: string;
  expires_at: string;
}

@Injectable()
export class RegistersService {
  constructor(private readonly db: DbService) {}

  async list(storeId: string): Promise<RegisterResource[]> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const rows = await tx.select().from(registers).orderBy(asc(registers.id));
      return Promise.all(rows.map((row) => this.toResource(tx, row)));
    });
  }

  async create(storeId: string, staffId: string, input: CreateRegisterInput): Promise<RegisterResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const location = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.id, input.location_id));
      if (location.length === 0) throw new NotFoundException('Location not found');
      const rows = await tx
        .insert(registers)
        .values({ id: ulid(), storeId, locationId: input.location_id, name: input.name })
        .returning();
      return this.toResource(tx, rows[0]!);
    });
  }

  async update(storeId: string, staffId: string, id: string, input: UpdateRegisterInput): Promise<RegisterResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const rows = await tx
        .update(registers)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.grid_layout !== undefined ? { gridLayout: input.grid_layout } : {}),
          updatedAt: new Date(),
        })
        .where(eq(registers.id, id))
        .returning();
      const row = rows[0];
      if (!row) throw new NotFoundException('Register not found');
      return this.toResource(tx, row);
    });
  }

  /**
   * One active code per register: issuing revokes any pending one (a lost
   * code is dead the moment a new one is generated).
   */
  async issueActivationCode(storeId: string, staffId: string, registerId: string): Promise<IssuedActivationCode> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const register = await tx
        .select({ id: registers.id })
        .from(registers)
        .where(eq(registers.id, registerId));
      if (register.length === 0) throw new NotFoundException('Register not found');

      await this.revokePending(tx, registerId);

      const code = Array.from(
        { length: CODE_LENGTH },
        () => CROCKFORD[randomInt(CROCKFORD.length)],
      ).join('');
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);
      await tx.insert(activationCodes).values({
        id: ulid(),
        storeId,
        registerId,
        codeHash: hashActivationCode(code),
        expiresAt,
        createdBy: staffId,
      });
      return { code, expires_at: expiresAt.toISOString() };
    });
  }

  async revokeActivationCode(storeId: string, staffId: string, registerId: string): Promise<void> {
    await this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const register = await tx
        .select({ id: registers.id })
        .from(registers)
        .where(eq(registers.id, registerId));
      if (register.length === 0) throw new NotFoundException('Register not found');
      await this.revokePending(tx, registerId);
    });
  }

  private async revokePending(tx: TenantTx, registerId: string): Promise<void> {
    await tx
      .update(activationCodes)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(activationCodes.registerId, registerId),
          isNull(activationCodes.usedAt),
          isNull(activationCodes.revokedAt),
        ),
      );
  }

  private async toResource(tx: TenantTx, row: typeof registers.$inferSelect): Promise<RegisterResource> {
    const pending = await tx
      .select({ expiresAt: activationCodes.expiresAt })
      .from(activationCodes)
      .where(
        and(
          eq(activationCodes.registerId, row.id),
          isNull(activationCodes.usedAt),
          isNull(activationCodes.revokedAt),
          gt(activationCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(activationCodes.id))
      .limit(1);
    return {
      id: row.id,
      location_id: row.locationId,
      name: row.name,
      active: row.active,
      grid_layout: row.gridLayout,
      pending_activation: pending[0] ? { expires_at: pending[0].expiresAt.toISOString() } : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
