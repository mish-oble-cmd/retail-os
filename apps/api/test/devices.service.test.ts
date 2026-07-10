/**
 * Device activation & trust (1B): one-time code exchange → rot_ token,
 * hash-only storage, single-use/expiry/revocation, bearer auth, admin revoke.
 */
import { createHash } from 'node:crypto';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { activationCodes, devices, locations, registers, roles, staff, stores } from '../src/db/schema';
import { DevicesService } from '../src/modules/sync/devices.service';
import { RegistersService } from '../src/modules/settings/registers.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let devicesService: DevicesService;
let registersService: RegistersService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAA1',
  register: '01REGAAAAAAAAAAAAAAAAAAAA1',
};

beforeAll(async () => {
  db = await createTestDb();
  const dbService = { tenants: db.tenants } as unknown as DbService;
  devicesService = new DevicesService(dbService);
  registersService = new RegistersService(dbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values({ id: A.store, name: 'Store A', currency: 'SGD' });
    await tx.insert(roles).values({ id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } });
    await tx.insert(staff).values({ id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
    await tx.insert(registers).values({ id: A.register, storeId: A.store, locationId: A.location, name: 'Front' });
  });
});

afterAll(async () => {
  await db.close();
});

const issueCode = async () =>
  (await registersService.issueActivationCode(A.store, A.owner, A.register)).code;

describe('DevicesService.activate', () => {
  it('exchanges a valid code for a device token and consumes the code', async () => {
    const code = await issueCode();
    const result = await devicesService.activate(code, '0.1.0-test');
    expect(result.deviceToken).toMatch(/^rot_[A-Za-z0-9_-]{40,}$/);
    expect(result).toMatchObject({ storeId: A.store, registerId: A.register, locationId: A.location });

    const rows = await db.tenants.forStore(A.store).tx(async (tx) => ({
      code: await tx.select().from(activationCodes),
      device: await tx.select().from(devices),
    }));
    expect(rows.code[0]?.usedAt).not.toBeNull();
    const expectedHash = createHash('sha256').update(result.deviceToken).digest('hex');
    expect(rows.device.some((d) => d.tokenHash === expectedHash)).toBe(true);
    // no plaintext token anywhere
    expect(rows.device.some((d) => JSON.stringify(d).includes(result.deviceToken))).toBe(false);
  });

  it('rejects a second use of the same code', async () => {
    const code = await issueCode();
    await devicesService.activate(code);
    await expect(devicesService.activate(code)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired code', async () => {
    const code = await issueCode();
    await db.tenants.forStore(A.store).tx(async (tx) => {
      await tx.update(activationCodes).set({ expiresAt: new Date(Date.now() - 1000) });
    });
    await expect(devicesService.activate(code)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a revoked code', async () => {
    const code = await issueCode();
    await registersService.revokeActivationCode(A.store, A.owner, A.register);
    await expect(devicesService.activate(code)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects garbage codes', async () => {
    await expect(devicesService.activate('NOPE9999')).rejects.toThrow(UnauthorizedException);
  });
});

describe('DevicesService.authenticate', () => {
  it('resolves a bearer token to the device context and bumps last_seen_at', async () => {
    const code = await issueCode();
    const { deviceToken } = await devicesService.activate(code);
    const ctx = await devicesService.authenticate(`Bearer ${deviceToken}`);
    expect(ctx).toMatchObject({ storeId: A.store, registerId: A.register, locationId: A.location });
    const row = await db.tenants.forStore(A.store).tx(async (tx) =>
      (await tx.select().from(devices).where(eq(devices.id, ctx.deviceId)))[0],
    );
    expect(row?.lastSeenAt).not.toBeNull();
  });

  it('rejects missing, malformed, and unknown tokens', async () => {
    await expect(devicesService.authenticate(undefined)).rejects.toThrow(UnauthorizedException);
    await expect(devicesService.authenticate('Bearer nope')).rejects.toThrow(UnauthorizedException);
    await expect(devicesService.authenticate('Bearer rot_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a revoked device and revoke 404s on unknown ids', async () => {
    const code = await issueCode();
    const { deviceToken } = await devicesService.activate(code);
    const ctx = await devicesService.authenticate(`Bearer ${deviceToken}`);
    await devicesService.revoke(A.store, A.owner, ctx.deviceId);
    await expect(devicesService.authenticate(`Bearer ${deviceToken}`)).rejects.toThrow(UnauthorizedException);
    await expect(devicesService.revoke(A.store, A.owner, ctx.deviceId)).rejects.toThrow(NotFoundException);
  });
});
