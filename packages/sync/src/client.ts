import { applyBootstrap, lastAckRev, pullOnce } from './apply.js';
import type { SqlDriver } from './driver.js';
import { SyncHttp } from './http.js';
import {
  pendingCount,
  pushWithRetry,
  recordRefund,
  recordSale,
  type LocalRefundInput,
  type LocalSaleInput,
} from './outbox.js';
import { migrateDeviceDb } from './schema.js';
import {
  closeShift,
  getActiveShift,
  getShiftZSource,
  openShift,
  recordCashMovement,
  type ActiveShift,
  type CashMovementInput,
  type CloseShiftInput,
  type OpenShiftInput,
  type ShiftZSource,
} from './shifts.js';

/**
 * Facade tying the engine together for a register app:
 * activate → bootstrap → recordSale/sync loop.
 *
 * Facts push BEFORE deltas pull (facts up, reference data down) so a
 * reconnecting register lands its sales before absorbing catalog changes.
 */

/**
 * Where the device token lives. Default is the sync_state row (encrypted
 * SQLite per offline-sync-strategy.md); the Electron OS-keychain adapter
 * arrives with the 1C wiring (1B decision 6).
 */
export interface SecretStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export class SqliteSecretStore implements SecretStore {
  constructor(private readonly driver: SqlDriver) {}

  get(key: string): string | undefined {
    if (key !== 'device_token') return undefined;
    return (
      this.driver.get<{ device_token: string | null }>(
        'SELECT device_token FROM sync_state WHERE id = 1',
      )?.device_token ?? undefined
    );
  }

  set(key: string, value: string): void {
    if (key !== 'device_token') throw new Error(`SqliteSecretStore only holds device_token, got ${key}`);
    this.driver.run('UPDATE sync_state SET device_token = ? WHERE id = 1', [value]);
  }
}

export interface SyncStatus {
  state: 'never_bootstrapped' | 'idle' | 'pending';
  pendingFacts: number;
  lastAckRev: number;
}

export interface SyncClientOptions {
  driver: SqlDriver;
  /** e.g. https://api.example.com/api/v1 */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  secrets?: SecretStore;
}

export class SyncClient {
  private readonly driver: SqlDriver;
  private readonly secrets: SecretStore;
  private readonly http: SyncHttp;

  constructor(opts: SyncClientOptions) {
    this.driver = opts.driver;
    migrateDeviceDb(this.driver);
    this.secrets = opts.secrets ?? new SqliteSecretStore(this.driver);
    this.http = new SyncHttp({
      baseUrl: opts.baseUrl,
      fetchImpl: opts.fetchImpl,
      getToken: () => this.secrets.get('device_token'),
    });
  }

  /** One-time code → device token + register identity, persisted for restarts. */
  async activate(code: string, appVersion?: string): Promise<void> {
    const result = await this.http.activate(code, appVersion);
    this.driver.tx(() => {
      this.driver.run(
        'UPDATE sync_state SET store_id = ?, register_id = ?, location_id = ? WHERE id = 1',
        [result.store_id, result.register_id, result.location_id],
      );
      this.secrets.set('device_token', result.device_token);
    });
  }

  async bootstrap(): Promise<void> {
    applyBootstrap(this.driver, await this.http.bootstrap());
  }

  /** Queue a completed sale locally (atomic outbox); push happens on sync(). */
  recordSale(sale: LocalSaleInput): void {
    recordSale(this.driver, sale);
  }

  /** Queue a refund locally (atomic outbox + order state); push happens on sync(). */
  recordRefund(refund: LocalRefundInput): void {
    recordRefund(this.driver, refund);
  }

  /** Open a shift with a counted float (atomic outbox); one open per register. */
  openShift(input: OpenShiftInput): void {
    openShift(this.driver, input);
  }

  /** Record a paid-in / paid-out / no-sale cash movement (atomic outbox). */
  recordCashMovement(input: CashMovementInput): void {
    recordCashMovement(this.driver, input);
  }

  /** Close a shift with a blind count + Z snapshot (atomic outbox). */
  closeShift(input: CloseShiftInput): void {
    closeShift(this.driver, input);
  }

  /** The single open shift for this device's register, or null. */
  getActiveShift(registerId: string): ActiveShift | null {
    return getActiveShift(this.driver, registerId);
  }

  /** Everything buildZReport needs for a shift (orders, refunds, movements, float). */
  getShiftZSource(shiftId: string): ShiftZSource {
    return getShiftZSource(this.driver, shiftId);
  }

  /** Push pending facts (with retry), then pull deltas. */
  async sync(opts?: { retries?: number }): Promise<{ pushed: number; pulled: number }> {
    const registerId = this.driver.get<{ register_id: string | null }>(
      'SELECT register_id FROM sync_state WHERE id = 1',
    )?.register_id;
    if (!registerId) throw new Error('sync: device is not activated yet');
    const { pushed } = await pushWithRetry(this.driver, this.http, registerId, opts);
    const { applied } = await pullOnce(this.driver, this.http);
    return { pushed, pulled: applied };
  }

  status(): SyncStatus {
    const rev = lastAckRev(this.driver);
    const pending = pendingCount(this.driver);
    return {
      state: rev === 0 ? 'never_bootstrapped' : pending > 0 ? 'pending' : 'idle',
      pendingFacts: pending,
      lastAckRev: rev,
    };
  }
}
