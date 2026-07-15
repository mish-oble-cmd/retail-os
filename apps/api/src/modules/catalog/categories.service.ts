import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { assertPermission } from '../../common/permissions';
import { DbService, type TenantTx } from '../../db/db.service';
import { categories, products } from '../../db/schema';
import type { CreateCategoryInput, UpdateCategoryInput } from './dto';

export interface CategoryResource {
  id: string;
  name: string;
  parent_id: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

type CategoryRow = typeof categories.$inferSelect;

function toResource(row: CategoryRow): CategoryResource {
  return {
    id: row.id,
    name: row.name,
    parent_id: row.parentId,
    sort: row.sort,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class CategoriesService {
  constructor(private readonly db: DbService) {}

  /** Flat, sort-ordered list (ADM-05 builds the tree client-side); stores stay small enough to skip pagination. */
  async list(storeId: string): Promise<CategoryResource[]> {
    const rows = await this.db.tenants
      .forStore(storeId)
      .tx((tx) =>
        tx.select().from(categories).orderBy(asc(categories.sort), asc(categories.name)),
      );
    return rows.map(toResource);
  }

  async create(
    storeId: string,
    staffId: string,
    input: CreateCategoryInput,
  ): Promise<CategoryResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'catalog_edit');
      if (input.parent_id) await this.requireCategory(tx, input.parent_id);
      const rows = await tx
        .insert(categories)
        .values({
          id: ulid(),
          storeId,
          name: input.name,
          parentId: input.parent_id ?? null,
          sort: input.sort ?? 0,
        })
        .returning();
      // why non-null: INSERT ... RETURNING yields exactly the inserted row.
      return toResource(rows[0]!);
    });
  }

  async update(
    storeId: string,
    staffId: string,
    id: string,
    input: UpdateCategoryInput,
  ): Promise<CategoryResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'catalog_edit');
      await this.requireCategory(tx, id);
      if (input.parent_id) {
        await this.requireCategory(tx, input.parent_id);
        await this.assertNoCycle(tx, id, input.parent_id);
      }
      const rows = await tx
        .update(categories)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.parent_id !== undefined ? { parentId: input.parent_id } : {}),
          ...(input.sort !== undefined ? { sort: input.sort } : {}),
          updatedAt: new Date(),
        })
        .where(eq(categories.id, id))
        .returning();
      return toResource(rows[0]!);
    });
  }

  async remove(storeId: string, staffId: string, id: string): Promise<void> {
    await this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, staffId, 'catalog_edit');
      await this.requireCategory(tx, id);
      const child = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.parentId, id))
        .limit(1);
      if (child.length > 0) {
        throw new ConflictException('Move or delete its subcategories first');
      }
      const product = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.categoryId, id))
        .limit(1);
      if (product.length > 0) {
        throw new ConflictException('Reassign its products first');
      }
      await tx.delete(categories).where(eq(categories.id, id));
    });
  }

  private async requireCategory(tx: TenantTx, id: string): Promise<CategoryRow> {
    const rows = await tx.select().from(categories).where(eq(categories.id, id));
    const row = rows[0];
    if (!row) throw new NotFoundException('Category not found');
    return row;
  }

  /** Walk up from the proposed parent; hitting `id` means the move creates a loop. */
  private async assertNoCycle(tx: TenantTx, id: string, newParentId: string): Promise<void> {
    let current: string | null = newParentId;
    // Depth cap guards against concurrently-created loops; honest trees never get here.
    for (let depth = 0; current !== null && depth < 100; depth++) {
      if (current === id) {
        throw new BadRequestException('A category cannot be moved under its own subtree');
      }
      const rows: Array<{ parentId: string | null }> = await tx
        .select({ parentId: categories.parentId })
        .from(categories)
        .where(eq(categories.id, current));
      current = rows[0]?.parentId ?? null;
    }
  }
}
