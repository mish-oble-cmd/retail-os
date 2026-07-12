/**
 * @retailos/sync — offline sync engine for POS registers (1B):
 * device SQLite schema, bootstrap/delta pull, atomic outbox + idempotent
 * pusher, SyncClient facade. See 03-architecture/offline-sync-strategy.md.
 */
export const PACKAGE_NAME = '@retailos/sync';

export type { SqlDriver } from './driver.js';
export { openBetterSqliteDriver } from './better-sqlite3-driver.js';
export { DEVICE_SCHEMA_VERSION, migrateDeviceDb } from './schema.js';
export {
  SyncHttp,
  SyncHttpError,
  type ActivateResponse,
  type BootstrapSnapshot,
  type Change,
  type ChangesPage,
  type DownEntityType,
  type FactAck,
  type SyncBatchBody,
  type SyncHttpOptions,
} from './http.js';
export { applyBootstrap, applyChanges, lastAckRev, pullOnce } from './apply.js';
export {
  claimBatch,
  markPushed,
  pendingCount,
  pushOnce,
  pushWithRetry,
  recordRefund,
  recordSale,
  type ClaimedBatch,
  type LocalDiscount,
  type LocalRefundInput,
  type LocalRefundLine,
  type LocalSaleInput,
  type LocalSaleLine,
  type LocalSalePayment,
  type LocalStockMovement,
  type LocalTaxLine,
} from './outbox.js';
export {
  discardParkedCart,
  getParkedCart,
  listParkedCarts,
  parkCart,
  retrieveParkedCart,
  type ParkCartInput,
  type ParkedCart,
  type ParkedCartSummary,
} from './parked.js';
export {
  getOrderDetail,
  getStoreMeta,
  listCategories,
  listRecentOrders,
  listSellableVariants,
  listTaxRates,
  lookupBarcode,
  searchSellableVariants,
  taxRatesByCategory,
  type CategoryRow,
  type OrderDetail,
  type OrderLineDetail,
  type OrderSummary,
  type PaymentDetail,
  type RefundDetail,
  type SellableVariant,
  type StoreMeta,
  type TaxRateRow,
} from './queries.js';
export {
  SqliteSecretStore,
  SyncClient,
  type SecretStore,
  type SyncClientOptions,
  type SyncStatus,
} from './client.js';
