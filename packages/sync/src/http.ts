/**
 * Wire types + thin fetch client for the /sync surface. Shapes mirror
 * apps/api/src/modules/sync (snake_case JSON).
 */

export type Row = Record<string, unknown>;

export type DownEntityType =
  | 'store'
  | 'role'
  | 'staff'
  | 'location'
  | 'register'
  | 'tax_category'
  | 'tax_rate'
  | 'category'
  | 'product'
  | 'variant'
  | 'barcode'
  | 'inventory_level'
  | 'tombstone';

export interface Change {
  type: DownEntityType;
  rev: number;
  data: Row;
}

export interface ChangesPage {
  changes: Change[];
  next_since: number;
  has_more: boolean;
}

export interface BootstrapSnapshot {
  rev: number;
  store: Row;
  data: {
    roles: Row[];
    staff: Row[];
    locations: Row[];
    registers: Row[];
    tax_categories: Row[];
    tax_rates: Row[];
    categories: Row[];
    products: Row[];
    variants: Row[];
    barcodes: Row[];
    inventory_levels: Row[];
  };
}

export interface FactAck {
  id: string;
  status: 'accepted' | 'duplicate' | 'accepted_with_conflict';
  conflict?: { type: string };
}

export interface SyncBatchBody {
  batch_id: string;
  client: { register_id: string; app_version?: string; schema_rev?: number };
  facts: (
    | { type: 'order.completed'; order: Row }
    | { type: 'stock.movement'; movement: Row }
  )[];
}

export interface ActivateResponse {
  device_token: string;
  store_id: string;
  register_id: string;
  location_id: string;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`sync request failed with ${status}`);
    this.name = 'SyncHttpError';
  }
}

export interface SyncHttpOptions {
  /** e.g. https://api.example.com/api/v1 (no trailing slash) */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  getToken: () => string | undefined;
}

export class SyncHttp {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SyncHttpOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const token = this.opts.getToken();
    if (token) headers['authorization'] = `Bearer ${token}`;
    const response = await this.fetchImpl(`${this.opts.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new SyncHttpError(response.status, payload);
    return payload as T;
  }

  activate(code: string, appVersion?: string): Promise<ActivateResponse> {
    return this.request('POST', '/sync/activate', { code, app_version: appVersion });
  }

  bootstrap(): Promise<BootstrapSnapshot> {
    return this.request('GET', '/sync/bootstrap');
  }

  changes(since: number, limit = 500): Promise<ChangesPage> {
    return this.request('GET', `/sync/changes?since=${since}&limit=${limit}`);
  }

  postBatch(body: SyncBatchBody): Promise<{ acks: FactAck[]; server_rev: number }> {
    return this.request('POST', '/sync/batches', body);
  }
}
