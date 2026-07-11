/**
 * Staff CRUD (1F): Owner-gated staff_edit, deactivation-not-deletion,
 * self/last-owner guards, and the no-hash-leak invariant — admin responses
 * never carry pin_hash/password_hash (the sync projection is the only carrier).
 */
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { verifyPin } from '@retailos/domain';
import type { DbService } from '../src/db/db.service';
import { roles, staff, stores } from '../src/db/schema';
import { StaffService } from '../src/modules/identity/staff.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let service: StaffService;

// Fixture ids stay inside the Crockford ULID alphabet [0-9A-HJKMNP-TV-Z]
// (no I, L, O, U) — hence "ST0RE" (zero) and "R0SE" standing in for the
// role ids ("ROLE" contains both O and L).
const A = {
  store: '01STAFFTESTST0REAAAAAAAAAA',
  ownerRole: '01STAFFTESTR0SEAAAAAAAAAAA',
  cashierRole: '01STAFFTESTR0SEAAAAAAAAAAC',
  owner: '01STAFFTESTSTAFFAAAAAAAAAA',
  cashier: '01STAFFTESTSTAFFAAAAAAAAAC',
};
const B = {
  store: '01STAFFTESTST0REBBBBBBBBBB',
  ownerRole: '01STAFFTESTR0SEBBBBBBBBBBB',
  owner: '01STAFFTESTSTAFFBBBBBBBBBB',
};

beforeAll(async () => {
  db = await createTestDb();
  service = new StaffService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values([
      { id: A.store, name: 'Store A', currency: 'SGD' },
      { id: B.store, name: 'Store B', currency: 'SGD' },
    ]);
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: { cashier: true, max_discount_pct: 10 } },
      { id: B.ownerRole, storeId: B.store, name: 'Owner', permissions: { owner: true } },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', email: 'owner-a@x.test', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
      { id: B.owner, storeId: B.store, name: 'Owner B', roleId: B.ownerRole },
    ]);
  });
});

afterAll(async () => {
  await db.close();
});

describe('staff CRUD', () => {
  it('lists staff with role names and has_pin, never hash material', async () => {
    const items = await service.list(A.store, A.owner);
    expect(items.map((s) => s.name).sort()).toEqual(['Cashier A', 'Owner A']);
    const cashier = items.find((s) => s.id === A.cashier)!;
    expect(cashier.role_name).toBe('Cashier');
    expect(cashier.has_pin).toBe(false);
    expect(JSON.stringify(items)).not.toMatch(/hash|argon2/i);
  });

  it('denies cashiers staff_edit', async () => {
    await expect(service.list(A.store, A.cashier)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.create(A.store, A.cashier, { name: 'X', role_id: A.cashierRole }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a cashier and updates name/role/active', async () => {
    const created = await service.create(A.store, A.owner, {
      name: 'New Hire',
      role_id: A.cashierRole,
      email: 'hire@x.test',
    });
    expect(created.role_name).toBe('Cashier');
    const renamed = await service.update(A.store, A.owner, created.id, { name: 'Renamed Hire' });
    expect(renamed.name).toBe('Renamed Hire');
    const deactivated = await service.update(A.store, A.owner, created.id, { active: false });
    expect(deactivated.active).toBe(false);
  });

  it('rejects duplicate emails within the store', async () => {
    await expect(
      service.create(A.store, A.owner, { name: 'Dup', role_id: A.cashierRole, email: 'owner-a@x.test' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects roles that do not belong to the store (tenant isolation)', async () => {
    await expect(
      service.create(A.store, A.owner, { name: 'Sneak', role_id: B.ownerRole }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('owner cannot deactivate their own account', async () => {
    await expect(
      service.update(A.store, A.owner, A.owner, { active: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the last active owner cannot be demoted', async () => {
    await expect(
      service.update(A.store, A.owner, A.owner, { role_id: A.cashierRole }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('listRoles returns the fixed pair for the store only', async () => {
    const roleList = await service.listRoles(A.store);
    expect(roleList.map((r) => r.name).sort()).toEqual(['Cashier', 'Owner']);
    expect(roleList.some((r) => r.id === B.ownerRole)).toBe(false);
  });
});

describe('setPin', () => {
  it('stores an argon2id hash the device library verifies (server argon2 → hash-wasm)', async () => {
    const resource = await service.setPin(A.store, A.owner, A.cashier, '0042');
    expect(resource.has_pin).toBe(true);
    expect(JSON.stringify(resource)).not.toMatch(/argon2/);
    const row = (
      await db.tenants.forStore(A.store).tx((tx) =>
        tx.select({ pinHash: staff.pinHash }).from(staff).where(eq(staff.id, A.cashier)),
      )
    )[0]!;
    expect(row.pinHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPin('0042', row.pinHash)).toBe(true);   // the 1F golden path
    expect(await verifyPin('4200', row.pinHash)).toBe(false);
  });

  it('bumps sync_rev so devices pull the change', async () => {
    const before = (
      await db.tenants.forStore(A.store).tx((tx) =>
        tx.select({ rev: staff.syncRev }).from(staff).where(eq(staff.id, A.cashier)),
      )
    )[0]!.rev;
    await service.setPin(A.store, A.owner, A.cashier, '731942');
    const after = (
      await db.tenants.forStore(A.store).tx((tx) =>
        tx.select({ rev: staff.syncRev }).from(staff).where(eq(staff.id, A.cashier)),
      )
    )[0]!.rev;
    expect(after).toBeGreaterThan(before);
  });

  it('cashiers cannot set PINs', async () => {
    await expect(service.setPin(A.store, A.cashier, A.cashier, '1234')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
