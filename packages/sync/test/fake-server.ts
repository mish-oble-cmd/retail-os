import type {
  BootstrapSnapshot,
  Change,
  ChangesPage,
  DownEntityType,
  FactAck,
  SyncBatchBody,
} from '../src/http.js';

/**
 * In-memory stand-in for the API's sync surface, semantics matching
 * apps/api/src/modules/sync (rev feed, stored-acks batch replay, per-fact
 * dedupe). `asFetch()` exposes it as a fetch impl so SyncHttp is exercised
 * for real — no sockets.
 */

type Row = Record<string, unknown>;

const MIRROR_TYPES = [
  'role',
  'staff',
  'location',
  'register',
  'tax_category',
  'tax_rate',
  'category',
  'product',
  'variant',
  'barcode',
  'inventory_level',
] as const;

const BOOTSTRAP_KEYS: Record<(typeof MIRROR_TYPES)[number], keyof BootstrapSnapshot['data']> = {
  role: 'roles',
  staff: 'staff',
  location: 'locations',
  register: 'registers',
  tax_category: 'tax_categories',
  tax_rate: 'tax_rates',
  category: 'categories',
  product: 'products',
  variant: 'variants',
  barcode: 'barcodes',
  inventory_level: 'inventory_levels',
};

export class FakeSyncServer {
  private rev = 0;
  private store: Row = {};
  private readonly entities = new Map<string, Map<string, Row>>();
  private readonly tombstones: Change[] = [];
  private readonly batches = new Map<string, FactAck[]>();
  readonly orders = new Map<string, Row>();
  readonly movements = new Map<string, Row>();
  activationCodes = new Map<string, { registerId: string; used: boolean }>();
  deviceToken: string | null = null;

  constructor() {
    for (const type of MIRROR_TYPES) this.entities.set(type, new Map());
    this.setStore({ id: 'STORE1', name: 'Fake', currency: 'SGD', timezone: 'Asia/Singapore', price_mode: 'tax_inclusive', settings: {} });
  }

  setStore(data: Row): void {
    this.store = { ...data, sync_rev: ++this.rev };
  }

  upsert(type: (typeof MIRROR_TYPES)[number], data: Row & { id: string }): void {
    this.entities.get(type)?.set(data.id, { ...data, sync_rev: ++this.rev });
  }

  delete(type: (typeof MIRROR_TYPES)[number], id: string): void {
    if (this.entities.get(type)?.delete(id)) {
      this.tombstones.push({
        type: 'tombstone',
        rev: ++this.rev,
        data: { entity_type: type, entity_id: id },
      });
    }
  }

  addActivationCode(code: string, registerId: string): void {
    this.activationCodes.set(code, { registerId, used: false });
  }

  bootstrap(): BootstrapSnapshot {
    const data = {} as BootstrapSnapshot['data'];
    for (const type of MIRROR_TYPES) {
      data[BOOTSTRAP_KEYS[type]] = [...(this.entities.get(type)?.values() ?? [])];
    }
    return { rev: this.rev, store: this.store, data };
  }

  changes(since: number, limit = 500): ChangesPage {
    const merged: Change[] = [];
    if (Number(this.store['sync_rev']) > since) {
      merged.push({ type: 'store', rev: Number(this.store['sync_rev']), data: this.store });
    }
    for (const type of MIRROR_TYPES) {
      for (const row of this.entities.get(type)?.values() ?? []) {
        const rev = Number(row['sync_rev']);
        if (rev > since) merged.push({ type, rev, data: row });
      }
    }
    for (const tombstone of this.tombstones) {
      if (tombstone.rev > since) merged.push(tombstone);
    }
    merged.sort((a, b) => a.rev - b.rev);
    const page = merged.slice(0, limit);
    const last = page[page.length - 1];
    return { changes: page, next_since: last ? last.rev : since, has_more: merged.length > limit };
  }

  postBatch(body: SyncBatchBody): { acks: FactAck[]; server_rev: number } {
    const existing = this.batches.get(body.batch_id);
    if (existing) return { acks: existing, server_rev: this.rev };
    const acks: FactAck[] = [];
    for (const fact of body.facts) {
      if (fact.type === 'order.completed') {
        const order = fact.order as Row & { id: string };
        if (this.orders.has(order.id)) {
          acks.push({ id: order.id, status: 'duplicate' });
        } else {
          this.orders.set(order.id, order);
          acks.push({ id: order.id, status: 'accepted' });
        }
      } else {
        const movement = fact.movement as Row & { id: string };
        if (this.movements.has(movement.id)) {
          acks.push({ id: movement.id, status: 'duplicate' });
        } else {
          this.movements.set(movement.id, movement);
          acks.push({ id: movement.id, status: 'accepted' });
        }
      }
    }
    this.batches.set(body.batch_id, acks);
    return { acks, server_rev: this.rev };
  }

  /** Routes the four /sync endpoints; enforces the bearer token like the API does. */
  asFetch(): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://fake');
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

      if (method === 'POST' && url.pathname.endsWith('/sync/activate')) {
        const { code } = JSON.parse(String(init?.body)) as { code: string };
        const entry = this.activationCodes.get(code);
        if (!entry || entry.used) return json(401, { title: 'Activation code is invalid, used, or expired' });
        entry.used = true;
        this.deviceToken = `rot_fake_${code}`;
        return json(201, {
          device_token: this.deviceToken,
          store_id: String(this.store['id']),
          register_id: entry.registerId,
          location_id: 'LOC1',
        });
      }

      if (headers.get('authorization') !== `Bearer ${this.deviceToken}`) {
        return json(401, { title: 'Unknown or revoked device token' });
      }
      if (method === 'GET' && url.pathname.endsWith('/sync/bootstrap')) {
        return json(200, this.bootstrap());
      }
      if (method === 'GET' && url.pathname.endsWith('/sync/changes')) {
        const since = Number(url.searchParams.get('since') ?? 0);
        const limit = Number(url.searchParams.get('limit') ?? 500);
        return json(200, this.changes(since, limit));
      }
      if (method === 'POST' && url.pathname.endsWith('/sync/batches')) {
        return json(201, this.postBatch(JSON.parse(String(init?.body)) as SyncBatchBody));
      }
      return json(404, { title: 'not found' });
    }) as typeof fetch;
  }
}

export type { DownEntityType };
