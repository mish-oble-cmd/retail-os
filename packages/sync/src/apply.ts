import type { SqlDriver } from './driver.js';
import type { BootstrapSnapshot, Change, ChangesPage, Row, SyncHttp } from './http.js';

/**
 * Applies server snapshots and deltas to the device mirror. Every page lands
 * in ONE transaction together with the last_ack_rev bump, so a crash mid-pull
 * resumes exactly where the last commit left off (offline-sync-strategy.md
 * §Client anatomy: "bumps last_ack_rev only after apply").
 */

interface TableSpec {
  table: string;
  columns: string[];
  /** object/array columns serialized to TEXT */
  json: string[];
}

const SPECS: Record<string, TableSpec> = {
  store: {
    table: 'store',
    columns: ['id', 'name', 'currency', 'timezone', 'price_mode', 'settings', 'sync_rev'],
    json: ['settings'],
  },
  role: { table: 'roles', columns: ['id', 'name', 'permissions', 'sync_rev'], json: ['permissions'] },
  staff: { table: 'staff', columns: ['id', 'name', 'role_id', 'pin_hash', 'active', 'sync_rev'], json: [] },
  location: { table: 'locations', columns: ['id', 'name', 'timezone', 'active', 'sync_rev'], json: [] },
  register: {
    table: 'registers',
    columns: ['id', 'location_id', 'name', 'grid_layout', 'active', 'sync_rev'],
    json: ['grid_layout'],
  },
  tax_category: { table: 'tax_categories', columns: ['id', 'name', 'sync_rev'], json: [] },
  tax_rate: {
    table: 'tax_rates',
    columns: ['id', 'tax_category_id', 'name', 'rate_bp', 'sync_rev'],
    json: [],
  },
  category: { table: 'categories', columns: ['id', 'parent_id', 'name', 'sort', 'sync_rev'], json: [] },
  product: {
    table: 'products',
    columns: [
      'id',
      'name',
      'description',
      'category_id',
      'brand',
      'images',
      'options',
      'tax_category_id',
      'status',
      'has_variants',
      'custom',
      'sync_rev',
    ],
    json: ['images', 'options', 'custom'],
  },
  variant: {
    table: 'variants',
    columns: [
      'id',
      'product_id',
      'option_values',
      'sku',
      'price_amount',
      'compare_at_amount',
      'cost_amount',
      'track_stock',
      'sync_rev',
    ],
    json: ['option_values'],
  },
  barcode: { table: 'barcodes', columns: ['id', 'variant_id', 'code', 'sync_rev'], json: [] },
  inventory_level: {
    table: 'inventory_levels',
    columns: ['id', 'variant_id', 'location_id', 'on_hand', 'reorder_point', 'reorder_qty', 'sync_rev'],
    json: [],
  },
};

/** bootstrap `data` key → change type, for reusing the same specs */
const BOOTSTRAP_TYPES: [keyof BootstrapSnapshot['data'], string][] = [
  ['roles', 'role'],
  ['staff', 'staff'],
  ['locations', 'location'],
  ['registers', 'register'],
  ['tax_categories', 'tax_category'],
  ['tax_rates', 'tax_rate'],
  ['categories', 'category'],
  ['products', 'product'],
  ['variants', 'variant'],
  ['barcodes', 'barcode'],
  ['inventory_levels', 'inventory_level'],
];

const toSqlValue = (spec: TableSpec, column: string, row: Row): unknown => {
  const value = row[column];
  if (value === undefined || value === null) return null;
  if (spec.json.includes(column)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
};

const upsert = (driver: SqlDriver, spec: TableSpec, row: Row): void => {
  const placeholders = spec.columns.map(() => '?').join(', ');
  const updates = spec.columns
    .filter((column) => column !== 'id')
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  driver.run(
    `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`,
    spec.columns.map((column) => toSqlValue(spec, column, row)),
  );
};

const applyChange = (driver: SqlDriver, change: Change): void => {
  if (change.type === 'tombstone') {
    const spec = SPECS[String(change.data['entity_type'])];
    // unknown entity types are ignored — an older client must not choke on new server entities
    if (spec) driver.run(`DELETE FROM ${spec.table} WHERE id = ?`, [change.data['entity_id']]);
    return;
  }
  const spec = SPECS[change.type];
  if (spec) upsert(driver, spec, change.data);
};

/** Clears the mirror, loads the snapshot, sets last_ack_rev — one tx. */
export function applyBootstrap(driver: SqlDriver, snapshot: BootstrapSnapshot): void {
  driver.tx(() => {
    for (const spec of Object.values(SPECS)) driver.run(`DELETE FROM ${spec.table}`);
    const storeSpec = SPECS['store'];
    if (storeSpec) upsert(driver, storeSpec, snapshot.store);
    for (const [key, type] of BOOTSTRAP_TYPES) {
      const spec = SPECS[type];
      if (!spec) continue;
      for (const row of snapshot.data[key]) upsert(driver, spec, row);
    }
    driver.run(`UPDATE sync_state SET last_ack_rev = ? WHERE id = 1`, [snapshot.rev]);
  });
}

/** Applies one page atomically with its cursor bump. */
export function applyChanges(driver: SqlDriver, page: ChangesPage): void {
  driver.tx(() => {
    for (const change of page.changes) applyChange(driver, change);
    driver.run(`UPDATE sync_state SET last_ack_rev = ? WHERE id = 1`, [page.next_since]);
  });
}

export function lastAckRev(driver: SqlDriver): number {
  return driver.get<{ last_ack_rev: number }>('SELECT last_ack_rev FROM sync_state')?.last_ack_rev ?? 0;
}

/** Pulls pages until the feed is drained. */
export async function pullOnce(
  driver: SqlDriver,
  http: SyncHttp,
  opts?: { pageSize?: number },
): Promise<{ pages: number; applied: number }> {
  let pages = 0;
  let applied = 0;
  for (;;) {
    const page = await http.changes(lastAckRev(driver), opts?.pageSize ?? 500);
    pages += 1;
    applied += page.changes.length;
    applyChanges(driver, page);
    if (!page.has_more) return { pages, applied };
  }
}
