/**
 * 1E onboarding status (FR-10.1): the first-sale checklist derives its five
 * steps from live data, so it can never drift. A fresh signup shows account +
 * store done, register/catalog/first_sale not, the first-sale step blocked with
 * a reason, and the activation code echoed while no device has activated.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { IdentityService } from '../src/modules/identity/identity.service';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service';
import { SampleDataService } from '../src/modules/onboarding/sample-data.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let identity: IdentityService;
let onboarding: OnboardingService;
let sample: SampleDataService;

beforeAll(async () => {
  db = await createTestDb();
  identity = new IdentityService({ tenants: db.tenants } as unknown as DbService);
  onboarding = new OnboardingService({ tenants: db.tenants } as unknown as DbService);
  sample = new SampleDataService({ tenants: db.tenants } as unknown as DbService);
});

afterAll(async () => {
  await db.close();
});

describe('OnboardingService.status', () => {
  it('reflects account + store done, register + catalog + first_sale not', async () => {
    const who = await identity.signup({
      email: 'o@x.co',
      password: 'longenough12',
      name: 'O',
      storeName: 'M',
      currency: 'SGD',
    });
    const status = await onboarding.status(who.storeId);
    expect(status.steps.account).toBe(true);
    expect(status.steps.store_profile).toBe(true);
    expect(status.steps.register).toBe(false);
    expect(status.steps.catalog).toBe(false);
    expect(status.steps.first_sale).toBe(false);
    expect(status.blocked.first_sale).toBeTruthy();
    expect(typeof status.activation_code).toBe('string');
    expect(status.activation_code!.length).toBeGreaterThan(0);
    expect(status.minutes_remaining).toBeGreaterThan(0);
  });

  it('flips catalog to done after the sample catalog is seeded', async () => {
    const who = await identity.signup({
      email: 'o2@x.co',
      password: 'longenough12',
      name: 'O2',
      storeName: 'M2',
      currency: 'SGD',
    });
    await sample.seed(who.storeId);
    const status = await onboarding.status(who.storeId);
    expect(status.steps.catalog).toBe(true);
  });
});
