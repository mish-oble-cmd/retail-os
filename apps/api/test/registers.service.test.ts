/**
 * Locations, registers, activation codes (ADM-16, Phase 1/1A): grid-layout
 * save, code policy (one pending code, 24 h TTL, hash-only storage, revoke),
 * permission gate, tenant isolation.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { activationCodes, roles, staff, stores } from '../src/db/schema';
import { LocationsService } from '../src/modules/settings/locations.service';
import { RegistersService, hashActivationCode } from '../src/modules/settings/registers.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let locationsService: LocationsService;
let registersService: RegistersService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  cashierRole: '01ROLEAAAAAAAAAAAAAAAAAAAC',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  cashier: '01STAFFAAAAAAAAAAAAAAAAAAC',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  ownerRole: '01ROLEBBBBBBBBBBBBBBBBBBBB',
  owner: '01STAFFBBBBBBBBBBBBBBBBBBB',
};

beforeAll(async () => {
  db = await createTestDb();
  const dbService = { tenants: db.tenants } as unknown as DbService;
  locationsService = new LocationsService(dbService);
  registersService = new RegistersService(dbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values([
      { id: A.store, name: 'Store A', currency: 'SGD', timezone: 'Asia/Singapore' },
      { id: B.store, name: 'Store B', currency: 'SGD' },
    ]);
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: {} },
      { id: B.ownerRole, storeId: B.store, name: 'Owner', permissions: { owner: true } },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
      { id: B.owner, storeId: B.store, name: 'Owner B', roleId: B.ownerRole },
    ]);
  });
});

afterAll(async () => {
  await db.close();
});

describe('locations & registers', () => {
  it('creates a location (store timezone default) and a register in it', async () => {
    const location = await locationsService.create(A.store, A.owner, { name: 'Tanjong Pagar' });
    expect(location.timezone).toBe('Asia/Singapore');

    const register = await registersService.create(A.store, A.owner, {
      location_id: location.id,
      name: 'Front Counter',
    });
    expect(register.location_id).toBe(location.id);
    expect(register.pending_activation).toBeNull();
  });

  it('saves a grid layout (ADM-16 designer)', async () => {
    const [register] = await registersService.list(A.store);
    const layout = {
      columns: 4,
      tiles: [
        { row: 0, col: 0, kind: 'product' as const, ref_id: '01PRODAAAAAAAAAAAAAAAAAAA1' },
      ],
    };
    const updated = await registersService.update(A.store, A.owner, register!.id, {
      grid_layout: layout,
    });
    expect(updated.grid_layout).toEqual(layout);
  });

  it('cashier cannot manage topology', async () => {
    await expect(
      locationsService.create(A.store, A.cashier, { name: 'Nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const [register] = await registersService.list(A.store);
    await expect(
      registersService.issueActivationCode(A.store, A.cashier, register!.id),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('activation codes', () => {
  it('issues an 8-char Crockford code with ~24 h expiry; stores only the hash', async () => {
    const [register] = await registersService.list(A.store);
    const issued = await registersService.issueActivationCode(A.store, A.owner, register!.id);
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const ttlMs = new Date(issued.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const rows = await db.tenants
      .forStore(A.store)
      .tx((tx) =>
        tx.select().from(activationCodes).where(eq(activationCodes.registerId, register!.id)),
      );
    expect(rows.some((r) => r.codeHash === issued.code)).toBe(false);
    expect(rows.some((r) => r.codeHash === hashActivationCode(issued.code))).toBe(true);

    const [listed] = await registersService.list(A.store);
    expect(listed!.pending_activation?.expires_at).toBe(issued.expires_at);
  });

  it('issuing again revokes the pending code; revoke clears it', async () => {
    const [register] = await registersService.list(A.store);
    const first = await registersService.issueActivationCode(A.store, A.owner, register!.id);
    const second = await registersService.issueActivationCode(A.store, A.owner, register!.id);
    expect(second.code).not.toBe(first.code);

    const pending = await db.tenants.forStore(A.store).tx((tx) =>
      tx.select().from(activationCodes).where(eq(activationCodes.registerId, register!.id)),
    );
    const open = pending.filter((r) => r.revokedAt === null && r.usedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0]?.codeHash).toBe(hashActivationCode(second.code));

    await registersService.revokeActivationCode(A.store, A.owner, register!.id);
    const [listed] = await registersService.list(A.store);
    expect(listed!.pending_activation).toBeNull();
  });
});

describe('tenant isolation', () => {
  it("store B cannot issue codes for store A's register", async () => {
    const [register] = await registersService.list(A.store);
    await expect(
      registersService.issueActivationCode(B.store, B.owner, register!.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await registersService.list(B.store)).toEqual([]);
  });
});
