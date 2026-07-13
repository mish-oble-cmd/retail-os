import { ConflictException, Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { ulid } from 'ulid';
import { DbService } from '../../db/db.service';
import {
  barcodes,
  categories,
  inventoryLevels,
  locations,
  orderLines,
  products,
  registers,
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

  async purge(storeId: string): Promise<PurgeResult> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      const storeRow = await tx
        .select({ settings: stores.settings })
        .from(stores)
        .where(eq(stores.id, storeId));
      const settings = (storeRow[0]?.settings ?? {}) as Record<string, unknown>;
      const onboarding = (settings.onboarding ?? {}) as OnboardingSettings;
      const batchId = onboarding.sample_batch_id;
      if (!batchId) return { removed: 0 };

      // Null the FK on any practice-sale lines first — the line already snapshots
      // name + unit price, so order history and reports are preserved.
      const batchVariants = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.sampleBatchId, batchId));
      const variantIds = batchVariants.map((v) => v.id);
      if (variantIds.length > 0) {
        await tx
          .update(orderLines)
          .set({ variantId: null })
          .where(inArray(orderLines.variantId, variantIds));
        await tx.delete(barcodes).where(inArray(barcodes.variantId, variantIds));
      }

      const productRows = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.sampleBatchId, batchId));
      const removed = productRows.length;

      await tx.delete(inventoryLevels).where(eq(inventoryLevels.sampleBatchId, batchId));
      await tx.delete(variants).where(eq(variants.sampleBatchId, batchId));
      await tx.delete(products).where(eq(products.sampleBatchId, batchId));
      await tx.delete(categories).where(eq(categories.sampleBatchId, batchId));

      // Clear the sample tiles from Register 1's grid.
      const regRows = await tx.select({ id: registers.id }).from(registers).limit(1);
      if (regRows[0]) {
        await tx
          .update(registers)
          .set({ gridLayout: { columns: 4, tiles: [] }, updatedAt: new Date() })
          .where(eq(registers.id, regRows[0].id));
      }

      const { sample_batch_id: _dropped, ...restOnboarding } = onboarding;
      await tx
        .update(stores)
        .set({ settings: { ...settings, onboarding: restOnboarding } })
        .where(eq(stores.id, storeId));

      return { removed };
    });
  }
}
