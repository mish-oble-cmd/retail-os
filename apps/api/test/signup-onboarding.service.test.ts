/**
 * 1E signup provisioning: signup now also creates the register loop (Main
 * location + Register 1 + an activation code echoed to stores.settings) so the
 * onboarding checklist has a real code the moment the wizard finishes, and the
 * store-profile PATCH updates name/currency/timezone/price_mode.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { locations, registers, stores } from '../src/db/schema';
import { IdentityService } from '../src/modules/identity/identity.service';
import { StoreService } from '../src/modules/settings/store.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let identity: IdentityService;
let storeService: StoreService;

beforeAll(async () => {
  db = await createTestDb();
  identity = new IdentityService({ tenants: db.tenants } as unknown as DbService);
  storeService = new StoreService({ tenants: db.tenants } as unknown as DbService);
});

afterAll(async () => {
  await db.close();
});

describe('signup onboarding provisioning', () => {
  it('creates a Main location, Register 1, and echoes an activation code', async () => {
    const who = await identity.signup({
      email: 'owner@example.com',
      password: 'longenough12',
      name: 'Bea Santos',
      storeName: 'Demo Mart',
      currency: 'SGD',
    });

    const rows = await db.tenants.forStore(who.storeId).tx(async (tx) => {
      const loc = await tx.select({ name: locations.name }).from(locations);
      const reg = await tx.select({ name: registers.name }).from(registers);
      const store = await tx
        .select({ settings: stores.settings })
        .from(stores)
        .where(eq(stores.id, who.storeId));
      return { loc, reg, settings: store[0]?.settings as Record<string, unknown> };
    });

    expect(rows.loc[0]?.name).toBe('Main');
    expect(rows.reg[0]?.name).toBe('Register 1');
    const onboarding = rows.settings?.onboarding as { activation_code?: string } | undefined;
    expect(typeof onboarding?.activation_code).toBe('string');
    expect(onboarding?.activation_code?.length).toBeGreaterThan(0);
  });

  it('records the owner name on the staff row', async () => {
    const me = await identity.me(
      (await identity.login('owner@example.com', 'longenough12')).storeId,
      (await identity.login('owner@example.com', 'longenough12')).staffId,
    );
    expect(me.name).toBe('Bea Santos');
  });

  it('updates the store profile via StoreService', async () => {
    const who = await identity.signup({
      email: 'owner2@example.com',
      password: 'longenough12',
      name: 'Ana',
      storeName: 'Provisional',
      currency: 'PHP',
    });
    const updated = await storeService.update(who.storeId, {
      name: 'Final Name',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      price_mode: 'tax_exclusive',
    });
    expect(updated).toMatchObject({
      name: 'Final Name',
      currency: 'SGD',
      timezone: 'Asia/Singapore',
      price_mode: 'tax_exclusive',
    });
  });
});
