import { Injectable } from '@nestjs/common';
import { calculateCart, type CartInput } from '@retailos/domain';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DbService, type TenantTx } from '../../db/db.service';
import {
  barcodes,
  categories,
  inventoryLevels,
  locations,
  orderLines,
  orders,
  payments,
  products,
  refundLines,
  refunds,
  registers,
  roles,
  staff,
  stockMovements,
  stores,
  syncBatches,
  syncConflicts,
  syncTombstones,
  taxCategories,
  taxRates,
  variants,
} from '../../db/schema';
import type { DeviceContext } from './devices.service';
import type { MovementFact, OrderFact, RefundFact, SyncBatchInput } from './dto';

/**
 * Down-sync surface (offline-sync-strategy.md): bootstrap snapshot + delta
 * feed by per-store sync_rev. Rows go out as snake_case JSON of the table
 * columns minus tenancy/audit noise, keeping sync_rev so the client can
 * reason about what it holds.
 */

type Row = Record<string, unknown>;

export interface BootstrapSnapshot {
  /** stores.sync_seq at snapshot time — same tx as the reads, so it covers them. */
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

const storeDown = (row: typeof stores.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  currency: row.currency,
  timezone: row.timezone,
  price_mode: row.priceMode,
  settings: row.settings,
  sync_rev: row.syncRev,
});

const roleDown = (row: typeof roles.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  permissions: row.permissions,
  sync_rev: row.syncRev,
});

/** Projection, not the row: pin_hash only — password/TOTP material never syncs down. */
const staffDown = (row: {
  id: string;
  name: string;
  roleId: string;
  pinHash: string | null;
  active: boolean;
  syncRev: number;
}): Row => ({
  id: row.id,
  name: row.name,
  role_id: row.roleId,
  pin_hash: row.pinHash,
  active: row.active,
  sync_rev: row.syncRev,
});

const locationDown = (row: typeof locations.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  active: row.active,
  sync_rev: row.syncRev,
});

const registerDown = (row: typeof registers.$inferSelect): Row => ({
  id: row.id,
  location_id: row.locationId,
  name: row.name,
  grid_layout: row.gridLayout,
  active: row.active,
  sync_rev: row.syncRev,
});

const taxCategoryDown = (row: typeof taxCategories.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  sync_rev: row.syncRev,
});

const taxRateDown = (row: typeof taxRates.$inferSelect): Row => ({
  id: row.id,
  tax_category_id: row.taxCategoryId,
  name: row.name,
  rate_bp: row.rateBp,
  sync_rev: row.syncRev,
});

const categoryDown = (row: typeof categories.$inferSelect): Row => ({
  id: row.id,
  parent_id: row.parentId,
  name: row.name,
  sort: row.sort,
  sync_rev: row.syncRev,
});

const productDown = (row: typeof products.$inferSelect): Row => ({
  id: row.id,
  name: row.name,
  description: row.description,
  category_id: row.categoryId,
  brand: row.brand,
  images: row.images,
  options: row.options,
  tax_category_id: row.taxCategoryId,
  status: row.status,
  has_variants: row.hasVariants,
  custom: row.custom,
  sync_rev: row.syncRev,
});

const variantDown = (row: typeof variants.$inferSelect): Row => ({
  id: row.id,
  product_id: row.productId,
  option_values: row.optionValues,
  sku: row.sku,
  price_amount: row.priceAmount,
  compare_at_amount: row.compareAtAmount,
  cost_amount: row.costAmount,
  track_stock: row.trackStock,
  sync_rev: row.syncRev,
});

const barcodeDown = (row: typeof barcodes.$inferSelect): Row => ({
  id: row.id,
  variant_id: row.variantId,
  code: row.code,
  sync_rev: row.syncRev,
});

const inventoryLevelDown = (row: typeof inventoryLevels.$inferSelect): Row => ({
  id: row.id,
  variant_id: row.variantId,
  location_id: row.locationId,
  on_hand: row.onHand,
  reorder_point: row.reorderPoint,
  reorder_qty: row.reorderQty,
  sync_rev: row.syncRev,
});

const STAFF_PROJECTION = {
  id: staff.id,
  name: staff.name,
  roleId: staff.roleId,
  pinHash: staff.pinHash,
  active: staff.active,
  syncRev: staff.syncRev,
};

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
  /** ascending by rev */
  changes: Change[];
  /** resume cursor: last rev in the page, or the request's `since` when empty */
  next_since: number;
  has_more: boolean;
}

export interface FactAck {
  id: string;
  status: 'accepted' | 'duplicate' | 'accepted_with_conflict';
  conflict?: { type: string };
}

export interface IngestResult {
  acks: FactAck[];
  server_rev: number;
}

@Injectable()
export class SyncService {
  constructor(private readonly db: DbService) {}

  async bootstrap(ctx: DeviceContext): Promise<BootstrapSnapshot> {
    return this.db.tenants.forStore(ctx.storeId).tx(async (tx) => {
      const [storeRow] = await tx.select().from(stores).where(eq(stores.id, ctx.storeId));
      if (!storeRow) throw new Error(`bootstrap: store ${ctx.storeId} not visible`);
      return {
        rev: storeRow.syncSeq,
        store: storeDown(storeRow),
        data: {
          roles: (await tx.select().from(roles)).map(roleDown),
          staff: (await tx.select(STAFF_PROJECTION).from(staff)).map(staffDown),
          locations: (await tx.select().from(locations)).map(locationDown),
          registers: (await tx.select().from(registers)).map(registerDown),
          tax_categories: (await tx.select().from(taxCategories)).map(taxCategoryDown),
          tax_rates: (await tx.select().from(taxRates)).map(taxRateDown),
          categories: (await tx.select().from(categories)).map(categoryDown),
          products: (await tx.select().from(products)).map(productDown),
          variants: (await tx.select().from(variants)).map(variantDown),
          barcodes: (await tx.select().from(barcodes)).map(barcodeDown),
          inventory_levels: (await tx.select().from(inventoryLevels)).map(inventoryLevelDown),
        },
      };
    });
  }

  /**
   * Delta feed: everything above `since`, merged across tables, ascending by
   * rev. Each table is read with limit+1 so has_more never lies even when a
   * single table fills the page.
   */
  async changes(ctx: DeviceContext, since: number, limit = 500): Promise<ChangesPage> {
    const cap = Math.min(Math.max(limit, 1), 500);
    return this.db.tenants.forStore(ctx.storeId).tx(async (tx) => {
      const probe = cap + 1;
      const merged: Change[] = [];

      const collect = async <T extends { syncRev: number }>(
        type: DownEntityType,
        rows: Promise<T[]>,
        map: (row: T) => Row,
      ) => {
        for (const row of await rows) merged.push({ type, rev: row.syncRev, data: map(row) });
      };

      await collect(
        'store',
        tx.select().from(stores).where(and(eq(stores.id, ctx.storeId), gt(stores.syncRev, since))),
        storeDown,
      );
      await collect(
        'role',
        tx.select().from(roles).where(gt(roles.syncRev, since)).orderBy(asc(roles.syncRev)).limit(probe),
        roleDown,
      );
      await collect(
        'staff',
        tx.select(STAFF_PROJECTION).from(staff).where(gt(staff.syncRev, since)).orderBy(asc(staff.syncRev)).limit(probe),
        staffDown,
      );
      await collect(
        'location',
        tx.select().from(locations).where(gt(locations.syncRev, since)).orderBy(asc(locations.syncRev)).limit(probe),
        locationDown,
      );
      await collect(
        'register',
        tx.select().from(registers).where(gt(registers.syncRev, since)).orderBy(asc(registers.syncRev)).limit(probe),
        registerDown,
      );
      await collect(
        'tax_category',
        tx
          .select()
          .from(taxCategories)
          .where(gt(taxCategories.syncRev, since))
          .orderBy(asc(taxCategories.syncRev))
          .limit(probe),
        taxCategoryDown,
      );
      await collect(
        'tax_rate',
        tx.select().from(taxRates).where(gt(taxRates.syncRev, since)).orderBy(asc(taxRates.syncRev)).limit(probe),
        taxRateDown,
      );
      await collect(
        'category',
        tx.select().from(categories).where(gt(categories.syncRev, since)).orderBy(asc(categories.syncRev)).limit(probe),
        categoryDown,
      );
      await collect(
        'product',
        tx.select().from(products).where(gt(products.syncRev, since)).orderBy(asc(products.syncRev)).limit(probe),
        productDown,
      );
      await collect(
        'variant',
        tx.select().from(variants).where(gt(variants.syncRev, since)).orderBy(asc(variants.syncRev)).limit(probe),
        variantDown,
      );
      await collect(
        'barcode',
        tx.select().from(barcodes).where(gt(barcodes.syncRev, since)).orderBy(asc(barcodes.syncRev)).limit(probe),
        barcodeDown,
      );
      await collect(
        'inventory_level',
        tx
          .select()
          .from(inventoryLevels)
          .where(gt(inventoryLevels.syncRev, since))
          .orderBy(asc(inventoryLevels.syncRev))
          .limit(probe),
        inventoryLevelDown,
      );
      await collect(
        'tombstone',
        tx
          .select()
          .from(syncTombstones)
          .where(gt(syncTombstones.syncRev, since))
          .orderBy(asc(syncTombstones.syncRev))
          .limit(probe),
        (row) => ({ entity_type: row.entityType, entity_id: row.entityId, sync_rev: row.syncRev }),
      );

      merged.sort((a, b) => a.rev - b.rev);
      const page = merged.slice(0, cap);
      const last = page[page.length - 1];
      return {
        changes: page,
        next_since: last ? last.rev : since,
        has_more: merged.length > cap,
      };
    });
  }

  /**
   * Fact ingest (offline-sync-strategy.md §Server ingest pipeline). One
   * transaction per batch: facts + acks + the sync_batches dedupe row commit
   * or roll back together, so a retry after any failure replays cleanly under
   * the same batch id. Golden rule: a completed sale is NEVER rejected —
   * divergence becomes a sync_conflicts row.
   */
  async ingestBatch(ctx: DeviceContext, batch: SyncBatchInput): Promise<IngestResult> {
    return this.db.tenants.forStore(ctx.storeId).tx(async (tx) => {
      const serverRev = async () =>
        (await tx.select({ syncSeq: stores.syncSeq }).from(stores).where(eq(stores.id, ctx.storeId)))[0]
          ?.syncSeq ?? 0;

      // Replay short-circuit: same batch id → same acks, nothing re-applied.
      const [existing] = await tx
        .select({ acks: syncBatches.acks })
        .from(syncBatches)
        .where(eq(syncBatches.id, batch.batch_id));
      if (existing) return { acks: existing.acks as FactAck[], server_rev: await serverRev() };

      const [storeRow] = await tx.select().from(stores).where(eq(stores.id, ctx.storeId));
      if (!storeRow) throw new Error(`ingest: store ${ctx.storeId} not visible`);
      const rateRows = await tx.select().from(taxRates);
      const ratesById = new Map(rateRows.map((rate) => [rate.id, rate.rateBp]));

      const acks: FactAck[] = [];
      for (const fact of batch.facts) {
        if (fact.type === 'order.completed') {
          acks.push(await this.ingestOrder(tx, ctx, storeRow, ratesById, fact));
        } else if (fact.type === 'refund.completed') {
          acks.push(await this.ingestRefund(tx, ctx, fact));
        } else {
          acks.push(await this.ingestMovement(tx, ctx, fact));
        }
      }

      await tx.insert(syncBatches).values({
        id: batch.batch_id,
        storeId: ctx.storeId,
        registerId: ctx.registerId,
        deviceId: ctx.deviceId,
        factCount: batch.facts.length,
        acks,
      });

      return { acks, server_rev: await serverRev() };
    });
  }

  private async ingestOrder(
    tx: TenantTx,
    ctx: DeviceContext,
    storeRow: typeof stores.$inferSelect,
    ratesById: Map<string, number>,
    fact: OrderFact,
  ): Promise<FactAck> {
    const order = fact.order;
    const [duplicate] = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, order.id));
    if (duplicate) return { id: order.id, status: 'duplicate' };

    // Revalidate with the same math the POS ran (AD-2). Unknown rate ids mean
    // the register was behind the catalog — skip the compare, flag it.
    let conflict: { type: string; details: Row } | null = null;
    const staleRate = order.lines
      .flatMap((line) => line.tax_lines)
      .find((taxLine) => !ratesById.has(taxLine.rate_id));
    if (staleRate) {
      conflict = {
        type: 'stale_reference',
        details: { unknown_rate_id: staleRate.rate_id },
      };
    } else {
      const cartInput: CartInput = {
        currency: storeRow.currency,
        priceMode: storeRow.priceMode,
        lines: order.lines.map((line) => ({
          id: line.id,
          unitPriceAmount: line.unit_price.amount,
          qty: line.qty,
          discounts: line.discounts,
          taxRates: line.tax_lines.map((taxLine) => ({
            id: taxLine.rate_id,
            // ratesById.has() checked above; fall back defensively anyway
            rateBp: ratesById.get(taxLine.rate_id) ?? 0,
          })),
        })),
      };
      const recomputed = calculateCart(cartInput);
      const serverTotals = {
        subtotal: recomputed.subtotalAmount,
        discount: recomputed.discountAmount,
        tax: recomputed.taxAmount,
        total: recomputed.totalAmount,
      };
      const diverges =
        serverTotals.subtotal !== order.totals.subtotal ||
        serverTotals.discount !== order.totals.discount ||
        serverTotals.tax !== order.totals.tax ||
        serverTotals.total !== order.totals.total;
      if (diverges) {
        conflict = {
          type: 'total_mismatch',
          details: { client_totals: order.totals, server_totals: serverTotals },
        };
      }
    }

    // Persist the client's charged amounts verbatim — money changed hands.
    await tx.insert(orders).values({
      id: order.id,
      storeId: ctx.storeId,
      registerId: ctx.registerId,
      locationId: ctx.locationId,
      staffId: order.staff_id ?? null,
      customerId: order.customer_id ?? null,
      number: order.number,
      state: 'completed',
      currency: storeRow.currency,
      subtotalAmount: order.totals.subtotal,
      discountAmount: order.totals.discount,
      taxAmount: order.totals.tax,
      totalAmount: order.totals.total,
      taxLines: order.tax_lines,
      note: order.note ?? null,
      source: 'pos',
      clientCreatedAt: new Date(order.client_created_at),
      localSeq: order.local_seq,
    });
    await tx.insert(orderLines).values(
      order.lines.map((line) => ({
        id: line.id,
        storeId: ctx.storeId,
        orderId: order.id,
        variantId: line.variant_id ?? null,
        name: line.name,
        qty: line.qty,
        unitPriceAmount: line.unit_price.amount,
        discounts: line.discounts,
        taxLines: line.tax_lines,
        totalAmount: line.total_amount,
      })),
    );
    await tx.insert(payments).values(
      order.payments.map((payment) => ({
        id: payment.id,
        storeId: ctx.storeId,
        orderId: order.id,
        tenderType: payment.tender,
        amount: payment.amount,
        changeAmount: payment.change,
        cardRef: payment.card_ref ?? null,
        cardLast4: payment.card_last4 ?? null,
        capturedAt: new Date(order.client_created_at),
      })),
    );

    if (conflict) {
      await tx.insert(syncConflicts).values({
        id: ulid(),
        storeId: ctx.storeId,
        conflictType: conflict.type,
        entityType: 'order',
        entityId: order.id,
        details: conflict.details,
      });
      return { id: order.id, status: 'accepted_with_conflict', conflict: { type: conflict.type } };
    }
    return { id: order.id, status: 'accepted' };
  }

  private async ingestRefund(
    tx: TenantTx,
    ctx: DeviceContext,
    fact: RefundFact,
  ): Promise<FactAck> {
    const refund = fact.refund;
    const [duplicate] = await tx
      .select({ id: refunds.id })
      .from(refunds)
      .where(eq(refunds.id, refund.id));
    if (duplicate) return { id: refund.id, status: 'duplicate' };

    // A refund always references a synced order: facts push in outbox order, so
    // the sale is ingested before its refund (a batch applies facts in order,
    // and refunds target prior orders). The refunds→orders FK enforces this —
    // a missing order rolls the batch back for a clean retry, never silent loss.
    await tx.insert(refunds).values({
      id: refund.id,
      storeId: ctx.storeId,
      orderId: refund.order_id,
      staffId: refund.staff_id,
      approvedBy: refund.approved_by ?? null,
      currency: refund.currency,
      totalAmount: refund.total_amount,
      taxAmount: refund.tax_amount,
      taxLines: refund.tax_lines,
      tenderType: refund.tender,
      cardRef: refund.card_ref ?? null,
      cardLast4: refund.card_last4 ?? null,
      clientCreatedAt: new Date(refund.client_created_at),
      localSeq: refund.local_seq,
    });
    await tx.insert(refundLines).values(
      refund.lines.map((line) => ({
        id: line.id,
        storeId: ctx.storeId,
        refundId: refund.id,
        orderLineId: line.order_line_id,
        variantId: line.variant_id ?? null,
        qty: line.qty,
        amount: line.amount,
        restock: line.restock,
      })),
    );

    // Derive order state from cumulative refunded qty vs. sold qty (invariant
    // 4: server sets order state; the register never mutates a synced order).
    const soldLines = await tx
      .select({ id: orderLines.id, qty: orderLines.qty })
      .from(orderLines)
      .where(eq(orderLines.orderId, refund.order_id));
    const refundedRows = await tx
      .select({ orderLineId: refundLines.orderLineId, qty: refundLines.qty })
      .from(refundLines)
      .innerJoin(refunds, eq(refundLines.refundId, refunds.id))
      .where(eq(refunds.orderId, refund.order_id));
    const refundedByLine = new Map<string, number>();
    for (const row of refundedRows) {
      refundedByLine.set(row.orderLineId, (refundedByLine.get(row.orderLineId) ?? 0) + row.qty);
    }
    const fullyRefunded =
      soldLines.length > 0 &&
      soldLines.every((line) => (refundedByLine.get(line.id) ?? 0) >= line.qty);
    await tx
      .update(orders)
      .set({ state: fullyRefunded ? 'refunded' : 'partially_refunded' })
      .where(eq(orders.id, refund.order_id));

    return { id: refund.id, status: 'accepted' };
  }

  private async ingestMovement(
    tx: TenantTx,
    ctx: DeviceContext,
    fact: MovementFact,
  ): Promise<FactAck> {
    const movement = fact.movement;
    const [duplicate] = await tx
      .select({ id: stockMovements.id })
      .from(stockMovements)
      .where(eq(stockMovements.id, movement.id));
    if (duplicate) return { id: movement.id, status: 'duplicate' };

    await tx.insert(stockMovements).values({
      id: movement.id,
      storeId: ctx.storeId,
      variantId: movement.variant_id,
      locationId: movement.location_id,
      qtyDelta: movement.qty_delta,
      movementType: movement.movement_type,
      refType: movement.ref_order_id ? 'order' : null,
      refId: movement.ref_order_id ?? null,
    });
    // Projection (data-model.md invariant 3): level = Σ ledger.
    await tx
      .insert(inventoryLevels)
      .values({
        id: ulid(),
        storeId: ctx.storeId,
        variantId: movement.variant_id,
        locationId: movement.location_id,
        onHand: movement.qty_delta,
      })
      .onConflictDoUpdate({
        target: [inventoryLevels.storeId, inventoryLevels.variantId, inventoryLevels.locationId],
        set: { onHand: sql`${inventoryLevels.onHand} + ${movement.qty_delta}` },
      });
    return { id: movement.id, status: 'accepted' };
  }
}
