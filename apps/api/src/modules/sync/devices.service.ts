import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { DbService } from '../../db/db.service';
import { activationCodes, devices, registers } from '../../db/schema';
import { hashActivationCode } from '../settings/registers.service';

/**
 * Register device trust (offline-sync-strategy.md §Register activation).
 * One-time activation code → opaque `rot_…` device token; only sha-256
 * hashes are ever stored, plaintext is shown/returned exactly once.
 */

export interface DeviceContext {
  deviceId: string;
  storeId: string;
  registerId: string;
  locationId: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

@Injectable()
export class DevicesService {
  constructor(private readonly db: DbService) {}

  /**
   * Exchange a one-time activation code for a device token. Cross-tenant:
   * the device knows only its 8-char code — code_hash is globally unique
   * (0003_sync.sql), so the lookup is unambiguous. Same justification class
   * as login-by-email (tenant-db.ts).
   */
  async activate(
    code: string,
    appVersion?: string,
  ): Promise<{ deviceToken: string; storeId: string; registerId: string; locationId: string }> {
    const codeHash = hashActivationCode(code.trim().toUpperCase());
    const token = `rot_${randomBytes(32).toString('base64url')}`;
    const result = await this.db.tenants.dangerouslyCrossTenant(
      'device activation: only the code is known, no tenant context exists yet',
      async (tx) => {
        // UPDATE … WHERE unused guards the race of two concurrent exchanges.
        const consumed = await tx
          .update(activationCodes)
          .set({ usedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(activationCodes.codeHash, codeHash),
              isNull(activationCodes.usedAt),
              isNull(activationCodes.revokedAt),
              gt(activationCodes.expiresAt, new Date()),
            ),
          )
          .returning({ storeId: activationCodes.storeId, registerId: activationCodes.registerId });
        const hit = consumed[0];
        if (!hit) return null;
        const [register] = await tx
          .select({ locationId: registers.locationId })
          .from(registers)
          .where(and(eq(registers.storeId, hit.storeId), eq(registers.id, hit.registerId)));
        if (!register) return null;
        await tx.insert(devices).values({
          id: ulid(),
          storeId: hit.storeId,
          registerId: hit.registerId,
          tokenHash: sha256(token),
          appVersion: appVersion ?? null,
        });
        return { storeId: hit.storeId, registerId: hit.registerId, locationId: register.locationId };
      },
    );
    if (!result) throw new UnauthorizedException('Activation code is invalid, used, or expired');
    return { deviceToken: token, ...result };
  }

  /** Resolve a sync-endpoint bearer token; bumps last_seen_at. */
  async authenticate(authorizationHeader: string | undefined): Promise<DeviceContext> {
    const token = /^Bearer (rot_[A-Za-z0-9_-]+)$/.exec(authorizationHeader ?? '')?.[1];
    if (!token) throw new UnauthorizedException('Device token required');
    const ctx = await this.db.tenants.dangerouslyCrossTenant(
      'device auth: token hash is the only credential, resolved before tenant context',
      async (tx) => {
        const updated = await tx
          .update(devices)
          .set({ lastSeenAt: new Date(), updatedAt: new Date() })
          .where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt)))
          .returning({ id: devices.id, storeId: devices.storeId, registerId: devices.registerId });
        const device = updated[0];
        if (!device) return null;
        const [register] = await tx
          .select({ locationId: registers.locationId })
          .from(registers)
          .where(and(eq(registers.storeId, device.storeId), eq(registers.id, device.registerId)));
        if (!register) return null;
        return {
          deviceId: device.id,
          storeId: device.storeId,
          registerId: device.registerId,
          locationId: register.locationId,
        };
      },
    );
    if (!ctx) throw new UnauthorizedException('Unknown or revoked device token');
    return ctx;
  }

  /** Admin revocation (ADM-16). */
  async revoke(storeId: string, staffId: string, deviceId: string): Promise<void> {
    await this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'registers_edit');
      const updated = await tx
        .update(devices)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      if (updated.length !== 1) throw new NotFoundException('Device not found or already revoked');
    });
  }
}
