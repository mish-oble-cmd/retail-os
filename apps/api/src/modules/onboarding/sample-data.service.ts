import { ConflictException, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DbService } from '../../db/db.service';
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
  stockMovements,
  stores,
  taxCategories,
  variants,
} from '../../db/schema';
import { SAMPLE_CATALOG_SG } from './sample-catalog.sg';

export interface SeedResult {
  batchId: string;
  productCount: number;
}

export interface PurgeResult {
  removed: number;
}

interface OnboardingSettings {
  activation_code?: string;
  activation_expires_at?: string;
  register_id?: string;
  sample_batch_id?: string;
  checklist_dismissed?: boolean;
}

/**
 * 1E sample catalog seed/purge (FR-10.1). Seeds the Singapore SGD dataset tagged
 * with one sample_batch_id so purge deletes exactly that batch. Purge nulls the
 * order_lines.variant_id FK for any practice sale first (lines snapshot name +
 * price, so order history and reports survive). The active batch id lives in
 * stores.settings.onboarding.sample_batch_id.
 */
@Injectable()
export class SampleDataService {
  constructor(private readonly db: DbService) {}

  async seed(storeId: string): Promise<SeedResult> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const storeRow = await tx
        .select({ settings: stores.settings })
        .from(stores)
        .where(eq(stores.id, storeId));
      const settings = (storeRow[0]?.settings ?? {}) as Record<string, unknown>;
      const onboarding = (settings.onboarding ?? {}) as OnboardingSettings;
      if (onboarding.sample_batch_id) {
        throw new ConflictException('Sample catalog already loaded');
      }

      const taxRows = await tx
        .select({ id: taxCategories.id })
        .from(taxCategories)
        .where(eq(taxCategories.name, 'Standard'))
        .limit(1);
      const taxCategoryId = taxRows[0]!.id;
      const locRows = await tx.select({ id: locations.id }).from(locations).limit(1);
      const locationId = locRows[0]!.id;
      const regRows = await tx.select({ id: registers.id }).from(registers).limit(1);
      const registerId = regRows[0]?.id;

      const batchId = ulid();

      // Categories → id map.
      const categoryIdByName = new Map<string, string>();
      for (const name of SAMPLE_CATALOG_SG.categories) {
        const id = ulid();
        categoryIdByName.set(name, id);
        await tx.insert(categories).values({ id, storeId, name, sampleBatchId: batchId });
      }

      // Products → variant → barcode → inventory, all tagged. Collect grid tiles.
      const tiles: { row: number; col: number; kind: 'product'; ref_id: string; label: string }[] = [];
      let index = 0;
      for (const p of SAMPLE_CATALOG_SG.products) {
        const productId = ulid();
        await tx.insert(products).values({
          id: productId,
          storeId,
          name: p.name,
          categoryId: categoryIdByName.get(p.category),
          taxCategoryId,
          status: 'active',
          sampleBatchId: batchId,
        });
        const variantId = ulid();
        await tx.insert(variants).values({
          id: variantId,
          storeId,
          productId,
          priceAmount: p.price,
          sampleBatchId: batchId,
        });
        await tx.insert(barcodes).values({
          id: ulid(),
          storeId,
          variantId,
          code: p.barcode,
        });
        await tx.insert(inventoryLevels).values({
          id: ulid(),
          storeId,
          variantId,
          locationId,
          onHand: p.stock,
          sampleBatchId: batchId,
        });
        tiles.push({
          row: Math.floor(index / 4),
          col: index % 4,
          kind: 'product',
          ref_id: variantId,
          label: p.name,
        });
        index += 1;
      }

      // Arrange the sample products on Register 1's grid so a practice sale is
      // one tap (POS-03). Overwrites the empty grid the signup created.
      if (registerId) {
        await tx
          .update(registers)
          .set({ gridLayout: { columns: 4, tiles }, updatedAt: new Date() })
          .where(eq(registers.id, registerId));
      }

      await tx
        .update(stores)
        .set({
          settings: { ...settings, onboarding: { ...onboarding, sample_batch_id: batchId } },
        })
        .where(eq(stores.id, storeId));

      return { batchId, productCount: SAMPLE_CATALOG_SG.products.length };
    });
  }

  /**
   * Delete the sample batch and its practice-sale ledger. A practice sale writes
   * an immutable stock_movement + order that the *app* role cannot delete
   * (append-only ledger, invariant 4), and those rows FK-block deleting the sold
   * sample variant. So purge runs under the explicitly-justified admin
   * escalation (the same BYPASSRLS role signup uses to create a tenant) — with
   * every statement scoped by store_id since RLS no longer applies. Pure
   * practice orders (every line a sample product) are deleted outright; a mixed
   * order that also holds a real line keeps that line — only its sample lines are
   * detached (variant_id nulled; the line snapshots name + price, so the real
   * sale's history survives).
   */
  async purge(storeId: string): Promise<PurgeResult> {
    return this.db.tenants.dangerouslyCrossTenant(
      'onboarding sample purge: removes the sample batch and its practice-sale ledger; the app role is append-only for stock_movements/orders, so this admin-scoped delete is the only clean path (every statement is store_id-scoped)',
      async (tx) => {
        const storeRow = await tx
          .select({ settings: stores.settings })
          .from(stores)
          .where(eq(stores.id, storeId));
        const settings = (storeRow[0]?.settings ?? {}) as Record<string, unknown>;
        const onboarding = (settings.onboarding ?? {}) as OnboardingSettings;
        const batchId = onboarding.sample_batch_id;
        if (!batchId) return { removed: 0 };

        const batchVariants = await tx
          .select({ id: variants.id })
          .from(variants)
          .where(and(eq(variants.storeId, storeId), eq(variants.sampleBatchId, batchId)));
        const variantIds = batchVariants.map((v) => v.id);
        const sampleSet = new Set(variantIds);

        // Classify every order touching a sample variant: pure practice (delete)
        // vs mixed with a real line (keep, detach the sample lines only).
        const practiceOrderIds: string[] = [];
        const mixedOrderIds: string[] = [];
        if (variantIds.length > 0) {
          const lines = await tx
            .select({ orderId: orderLines.orderId, variantId: orderLines.variantId })
            .from(orderLines)
            .where(eq(orderLines.storeId, storeId));
          const agg = new Map<string, { sample: boolean; other: boolean }>();
          for (const line of lines) {
            const entry = agg.get(line.orderId) ?? { sample: false, other: false };
            if (line.variantId && sampleSet.has(line.variantId)) entry.sample = true;
            else entry.other = true;
            agg.set(line.orderId, entry);
          }
          for (const [orderId, entry] of agg) {
            if (!entry.sample) continue;
            (entry.other ? mixedOrderIds : practiceOrderIds).push(orderId);
          }
        }

        // Pure practice orders: delete children then the order.
        if (practiceOrderIds.length > 0) {
          const refundRows = await tx
            .select({ id: refunds.id })
            .from(refunds)
            .where(and(eq(refunds.storeId, storeId), inArray(refunds.orderId, practiceOrderIds)));
          const refundIds = refundRows.map((r) => r.id);
          if (refundIds.length > 0) {
            await tx
              .delete(refundLines)
              .where(and(eq(refundLines.storeId, storeId), inArray(refundLines.refundId, refundIds)));
            await tx
              .delete(refunds)
              .where(and(eq(refunds.storeId, storeId), inArray(refunds.id, refundIds)));
          }
          await tx
            .delete(payments)
            .where(and(eq(payments.storeId, storeId), inArray(payments.orderId, practiceOrderIds)));
          await tx
            .delete(orderLines)
            .where(and(eq(orderLines.storeId, storeId), inArray(orderLines.orderId, practiceOrderIds)));
          await tx
            .delete(orders)
            .where(and(eq(orders.storeId, storeId), inArray(orders.id, practiceOrderIds)));
        }

        // Mixed orders: detach only the sample lines, keeping the real sale.
        if (mixedOrderIds.length > 0 && variantIds.length > 0) {
          await tx
            .update(orderLines)
            .set({ variantId: null })
            .where(
              and(
                eq(orderLines.storeId, storeId),
                inArray(orderLines.orderId, mixedOrderIds),
                inArray(orderLines.variantId, variantIds),
              ),
            );
        }

        // Now the sample variants have no order/movement references — delete them.
        if (variantIds.length > 0) {
          await tx
            .delete(stockMovements)
            .where(and(eq(stockMovements.storeId, storeId), inArray(stockMovements.variantId, variantIds)));
          await tx
            .delete(barcodes)
            .where(and(eq(barcodes.storeId, storeId), inArray(barcodes.variantId, variantIds)));
        }

        const productRows = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.storeId, storeId), eq(products.sampleBatchId, batchId)));
        const removed = productRows.length;

        await tx
          .delete(inventoryLevels)
          .where(and(eq(inventoryLevels.storeId, storeId), eq(inventoryLevels.sampleBatchId, batchId)));
        await tx
          .delete(variants)
          .where(and(eq(variants.storeId, storeId), eq(variants.sampleBatchId, batchId)));
        await tx
          .delete(products)
          .where(and(eq(products.storeId, storeId), eq(products.sampleBatchId, batchId)));
        await tx
          .delete(categories)
          .where(and(eq(categories.storeId, storeId), eq(categories.sampleBatchId, batchId)));

        // Clear the sample tiles from Register 1's grid.
        const regRows = await tx
          .select({ id: registers.id })
          .from(registers)
          .where(eq(registers.storeId, storeId))
          .limit(1);
        if (regRows[0]) {
          await tx
            .update(registers)
            .set({ gridLayout: { columns: 4, tiles: [] }, updatedAt: new Date() })
            .where(and(eq(registers.storeId, storeId), eq(registers.id, regRows[0].id)));
        }

        const { sample_batch_id: _dropped, ...restOnboarding } = onboarding;
        await tx
          .update(stores)
          .set({ settings: { ...settings, onboarding: restOnboarding } })
          .where(eq(stores.id, storeId));

        return { removed };
      },
    );
  }
}
