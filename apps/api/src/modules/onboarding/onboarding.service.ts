import { Injectable } from '@nestjs/common';
import { count, eq, isNull } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { devices, orders, products, stores } from '../../db/schema';

export interface OnboardingSteps {
  account: boolean;
  store_profile: boolean;
  catalog: boolean;
  register: boolean;
  first_sale: boolean;
}

export interface OnboardingStatus {
  steps: OnboardingSteps;
  blocked: { first_sale?: string };
  activation_code?: string;
  activation_expires_at?: string;
  store_name: string;
  currency: string;
  minutes_remaining: number;
  dismissed: boolean;
}

interface OnboardingSettings {
  activation_code?: string;
  activation_expires_at?: string;
  register_id?: string;
  sample_batch_id?: string;
  checklist_dismissed?: boolean;
}

/** Rough per-step time budget matching the mockup's "~N more minutes" headline. */
const MINUTES_PER_STEP = 3;

/**
 * 1E onboarding status (FR-10.1). Every step is derived from live data — no
 * separate state to drift. The activation code is echoed from settings only
 * while no device has activated; once the register connects we stop echoing it.
 */
@Injectable()
export class OnboardingService {
  constructor(private readonly db: DbService) {}

  async status(storeId: string): Promise<OnboardingStatus> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const storeRows = await tx
        .select({ name: stores.name, currency: stores.currency, settings: stores.settings })
        .from(stores)
        .where(eq(stores.id, storeId));
      const store = storeRows[0];
      const settings = (store?.settings ?? {}) as Record<string, unknown>;
      const onboarding = (settings.onboarding ?? {}) as OnboardingSettings;

      const [productCount] = await tx.select({ n: count() }).from(products);
      const [deviceCount] = await tx
        .select({ n: count() })
        .from(devices)
        .where(isNull(devices.revokedAt));
      const [orderCount] = await tx.select({ n: count() }).from(orders);

      const registerConnected = (deviceCount?.n ?? 0) > 0;
      const steps: OnboardingSteps = {
        account: true,
        store_profile: Boolean(store),
        catalog: (productCount?.n ?? 0) > 0,
        register: registerConnected,
        first_sale: (orderCount?.n ?? 0) > 0,
      };

      const notDone = Object.values(steps).filter((done) => !done).length;
      const blocked: { first_sale?: string } = {};
      if (!steps.register && !steps.first_sale) {
        blocked.first_sale = 'Waiting for a register';
      }

      return {
        steps,
        blocked,
        // Stop echoing the plaintext code once the register has connected.
        activation_code: registerConnected ? undefined : onboarding.activation_code,
        activation_expires_at: registerConnected ? undefined : onboarding.activation_expires_at,
        store_name: store?.name ?? '',
        currency: store?.currency ?? '',
        minutes_remaining: notDone * MINUTES_PER_STEP,
        dismissed: onboarding.checklist_dismissed === true,
      };
    });
  }

  async dismiss(storeId: string): Promise<void> {
    await this.db.tenants.forStore(storeId).tx(async (tx) => {
      const storeRows = await tx
        .select({ settings: stores.settings })
        .from(stores)
        .where(eq(stores.id, storeId));
      const settings = (storeRows[0]?.settings ?? {}) as Record<string, unknown>;
      const onboarding = (settings.onboarding ?? {}) as OnboardingSettings;
      await tx
        .update(stores)
        .set({ settings: { ...settings, onboarding: { ...onboarding, checklist_dismissed: true } } })
        .where(eq(stores.id, storeId));
    });
  }
}
