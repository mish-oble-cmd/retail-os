import { createApiClient } from '@retailos/api-client';

export const api = createApiClient({
  baseUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001',
});

export interface MeResource {
  staff_id: string;
  store_id: string;
  name: string;
  email: string;
  role: string;
}
