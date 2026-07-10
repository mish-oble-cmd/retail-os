/**
 * Categories CRUD (FR-2.1 category tree, Phase 1/1A) against real SQL:
 * tree rules (no cycles, delete only when empty), permission gate
 * (owner-only in Phase 1), and tenant isolation on the new endpoints.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { products, roles, staff, stores, taxCategories } from '../src/db/schema';
import { CategoriesService } from '../src/modules/catalog/categories.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let service: CategoriesService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  cashierRole: '01ROLEAAAAAAAAAAAAAAAAAAAC',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  cashier: '01STAFFAAAAAAAAAAAAAAAAAAC',
  taxCategory: '01TAXCATAAAAAAAAAAAAAAAAAA',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  ownerRole: '01ROLEBBBBBBBBBBBBBBBBBBBB',
  owner: '01STAFFBBBBBBBBBBBBBBBBBBB',
};

beforeAll(async () => {
  db = await createTestDb();
  service = new CategoriesService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed: two tenants', async (tx) => {
    await tx.insert(stores).values({ id: A.store, name: 'Store A', currency: 'SGD' });
    await tx.insert(stores).values({ id: B.store, name: 'Store B', currency: 'SGD' });
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      // Phase 1 Cashier: sell-side permissions only — no catalog_edit.
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: {} },
      { id: B.ownerRole, storeId: B.store, name: 'Owner', permissions: { owner: true } },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
      { id: B.owner, storeId: B.store, name: 'Owner B', roleId: B.ownerRole },
    ]);
    await tx
      .insert(taxCategories)
      .values({ id: A.taxCategory, storeId: A.store, name: 'Standard' });
  });
});

afterAll(async () => {
  await db.close();
});

describe('categories CRUD', () => {
  it('creates and lists sort-ordered', async () => {
    const drinks = await service.create(A.store, A.owner, { name: 'Drinks', sort: 2 });
    const snacks = await service.create(A.store, A.owner, { name: 'Snacks', sort: 1 });
    const listed = await service.list(A.store);
    expect(listed.map((c) => c.name)).toEqual(['Snacks', 'Drinks']);
    expect(drinks.parent_id).toBeNull();
    expect(snacks.sort).toBe(1);
  });

  it('nests under a parent and re-parents on update', async () => {
    const parent = await service.create(A.store, A.owner, { name: 'Beverages' });
    const child = await service.create(A.store, A.owner, {
      name: 'Coffee',
      parent_id: parent.id,
    });
    expect(child.parent_id).toBe(parent.id);

    const moved = await service.update(A.store, A.owner, child.id, { parent_id: null });
    expect(moved.parent_id).toBeNull();
  });

  it('rejects a missing parent', async () => {
    await expect(
      service.create(A.store, A.owner, { name: 'Orphan', parent_id: '01NOPElNOPENOPENOPENOPENOP' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects moving a category under its own subtree', async () => {
    const top = await service.create(A.store, A.owner, { name: 'Top' });
    const mid = await service.create(A.store, A.owner, { name: 'Mid', parent_id: top.id });
    const leaf = await service.create(A.store, A.owner, { name: 'Leaf', parent_id: mid.id });
    await expect(
      service.update(A.store, A.owner, top.id, { parent_id: leaf.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(A.store, A.owner, top.id, { parent_id: top.id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to delete a category that still has children or products', async () => {
    const parent = await service.create(A.store, A.owner, { name: 'Pantry' });
    const child = await service.create(A.store, A.owner, { name: 'Rice', parent_id: parent.id });
    await expect(service.remove(A.store, A.owner, parent.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    await db.tenants.forStore(A.store).tx((tx) =>
      tx.insert(products).values({
        id: '01PRODAAAAAAAAAAAAAAAAAAA1',
        storeId: A.store,
        name: 'Jasmine Rice 5kg',
        categoryId: child.id,
        taxCategoryId: A.taxCategory,
      }),
    );
    await expect(service.remove(A.store, A.owner, child.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deletes an empty category', async () => {
    const doomed = await service.create(A.store, A.owner, { name: 'Seasonal' });
    await service.remove(A.store, A.owner, doomed.id);
    const listed = await service.list(A.store);
    expect(listed.find((c) => c.id === doomed.id)).toBeUndefined();
  });
});

describe('permissions (Phase 1 fixed roles)', () => {
  it('cashier cannot create, update, or delete categories', async () => {
    const existing = await service.create(A.store, A.owner, { name: 'Owner Made' });
    await expect(
      service.create(A.store, A.cashier, { name: 'Cashier Made' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.update(A.store, A.cashier, existing.id, { name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.remove(A.store, A.cashier, existing.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('cashier can still read the list (POS needs the tree)', async () => {
    const listed = await service.list(A.store);
    expect(listed.length).toBeGreaterThan(0);
  });
});

describe('tenant isolation', () => {
  it("store B neither sees nor mutates store A's categories", async () => {
    const target = await service.create(A.store, A.owner, { name: 'A Only' });
    const bList = await service.list(B.store);
    expect(bList.find((c) => c.id === target.id)).toBeUndefined();
    // RLS hides the row entirely → B gets a 404, not a 403 (no existence leak).
    await expect(
      service.update(B.store, B.owner, target.id, { name: 'Hijacked' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(B.store, B.owner, target.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
