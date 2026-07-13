import { api } from './api';

/**
 * Typed wrappers over the 1E onboarding + store-profile endpoints (FR-10.1).
 * Shapes mirror the API resources 1:1 (snake_case JSON).
 */

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

export interface StoreProfilePatch {
  name?: string;
  currency?: string;
  timezone?: string;
  price_mode?: 'tax_inclusive' | 'tax_exclusive';
}

export interface StoreProfileResource {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  price_mode: 'tax_inclusive' | 'tax_exclusive';
}

export const onboardingApi = {
  getStatus: () => api.get<OnboardingStatus>('/api/v1/onboarding/status'),
  updateStore: (patch: StoreProfilePatch) =>
    api.patch<StoreProfileResource>('/api/v1/settings/store', patch),
  seedSample: () => api.post<{ batchId: string; productCount: number }>('/api/v1/onboarding/sample-catalog'),
  purgeSample: () => api.delete<{ removed: number }>('/api/v1/onboarding/sample-catalog'),
  dismiss: () => api.post<void>('/api/v1/onboarding/dismiss'),
};
