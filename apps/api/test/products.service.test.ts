/**
 * Products/variants/barcodes (FR-2.1, FR-2.2 basic, Phase 1/1A) against real
 * SQL: options-matrix validation, opening stock through the ledger (invariant
 * #3), barcode uniqueness, search + keyset pagination, permission gate,
 * tenant isolation.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import {
  inventoryLevels,
  locations,
  roles,
  staff,
  stockMovements,
  stores,
  taxCategories,
} from '../src/db/schema';
import { ProductsService } from '../src/modules/catalog/products.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let service: ProductsService;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  cashierRole: '01ROLEAAAAAAAAAAAAAAAAAAAC',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  cashier: '01STAFFAAAAAAAAAAAAAAAAAAC',
  taxCategory: '01TAXCATAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAAA',
};
const B = {
  store: '01STOREBBBBBBBBBBBBBBBBBBB',
  ownerRole: '01ROLEBBBBBBBBBBBBBBBBBBBB',
  owner: '01STAFFBBBBBBBBBBBBBBBBBBB',
  taxCategory: '01TAXCATBBBBBBBBBBBBBBBBBB',
};

const sgd = (amount: number) => ({ amount, currency: 'SGD' as const });

beforeAll(async () => {
  db = await createTestDb();
  service = new ProductsService({ tenants: db.tenants } as unknown as DbService);
  await db.tenants.dangerouslyCrossTenant('test seed: two tenants', async (tx) => {
    await tx.insert(stores).values([
      { id: A.store, name: 'Store A', currency: 'SGD' },
      { id: B.store, name: 'Store B', currency: 'SGD' },
    ]);
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: {} },
      { id: B.ownerRole, storeId: B.store, name: 'Owner', permissions: { owner: true } },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
      { id: B.owner, storeId: B.store, name: 'Owner B', roleId: B.ownerRole },
    ]);
    await tx.insert(taxCategories).values([
      { id: A.taxCategory, storeId: A.store, name: 'Standard' },
      { id: B.taxCategory, storeId: B.store, name: 'Standard' },
    ]);
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
  });
});

afterAll(async () => {
  await db.close();
});

describe('create', () => {
  it('creates a simple product (one variant, no options) with default tax category', async () => {
    const product = await service.create(A.store, A.owner, {
      name: 'Kopi O',
      status: 'active',
      options: [],
      variants: [{ option_values: {}, barcodes: [], price: sgd(180), track_stock: true }],
    });
    expect(product.has_variants).toBe(false);
    expect(product.tax_category_id).toBe(A.taxCategory);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]?.price).toEqual({ amount: 180, currency: 'SGD' });
    expect(product.variants[0]?.on_hand).toBe(0);
  });

  it('creates an options-matrix product with barcodes and opening stock through the ledger', async () => {
    const product = await service.create(A.store, A.owner, {
      name: 'RetailOS Tee',
      status: 'active',
      options: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Color', values: ['Black'] },
      ],
      variants: [
        {
          option_values: { Size: 'S', Color: 'Black' },
          sku: 'TEE-S-BLK',
          barcodes: ['8880000000011'],
          price: sgd(2500),
          track_stock: true,
          initial_stock: 5,
        },
        {
          option_values: { Size: 'M', Color: 'Black' },
          sku: 'TEE-M-BLK',
          barcodes: ['8880000000028'],
          price: sgd(2500),
          track_stock: true,
          initial_stock: 7,
        },
      ],
    });
    expect(product.has_variants).toBe(true);
    expect(product.variants.map((v) => v.on_hand)).toEqual([5, 7]);

    // Invariant #3: level equals the sum of ledger movements.
    const variantId = product.variants[0]!.id;
    const [movements, levels] = await db.tenants.forStore(A.store).tx(async (tx) => [
      await tx.select().from(stockMovements).where(eq(stockMovements.variantId, variantId)),
      await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, variantId)),
    ]);
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      qtyDelta: 5,
      movementType: 'count',
      reason: 'initial',
      staffId: A.owner,
    });
    expect(levels[0]?.onHand).toBe(5);
  });

  it('rejects matrix violations', async () => {
    const base = { name: 'Bad', status: 'active' as const };
    // undeclared option value
    await expect(
      service.create(A.store, A.owner, {
        ...base,
        options: [{ name: 'Size', values: ['S'] }],
        variants: [{ option_values: { Size: 'XL' }, barcodes: [], price: sgd(100), track_stock: true }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // duplicate combination
    await expect(
      service.create(A.store, A.owner, {
        ...base,
        options: [{ name: 'Size', values: ['S'] }],
        variants: [
          { option_values: { Size: 'S' }, barcodes: [], price: sgd(100), track_stock: true },
          { option_values: { Size: 'S' }, barcodes: [], price: sgd(200), track_stock: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // multiple variants without options
    await expect(
      service.create(A.store, A.owner, {
        ...base,
        options: [],
        variants: [
          { option_values: {}, barcodes: [], price: sgd(100), track_stock: true },
          { option_values: {}, barcodes: [], price: sgd(200), track_stock: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a wrong-currency amount', async () => {
    await expect(
      service.create(A.store, A.owner, {
        name: 'Peso Priced',
        status: 'active',
        options: [],
        variants: [
          { option_values: {}, barcodes: [], price: { amount: 100, currency: 'PHP' }, track_stock: true },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects barcodes already used in the store, naming them', async () => {
    await expect(
      service.create(A.store, A.owner, {
        name: 'Clash',
        status: 'active',
        options: [],
        variants: [
          { option_values: {}, barcodes: ['8880000000011'], price: sgd(900), track_stock: true },
        ],
      }),
    ).rejects.toThrow(/8880000000011/);
  });
});

describe('variants', () => {
  it('adds, patches (barcode set replace), and blocks deleting the last variant', async () => {
    const product = await service.create(A.store, A.owner, {
      name: 'Teh Tarik',
      status: 'active',
      options: [{ name: 'Size', values: ['R', 'L'] }],
      variants: [
        { option_values: { Size: 'R' }, barcodes: ['8880000000103'], price: sgd(160), track_stock: true },
      ],
    });

    const large = await service.addVariant(A.store, A.owner, product.id, {
      option_values: { Size: 'L' },
      sku: 'TEH-L',
      barcodes: ['8880000000110'],
      price: sgd(220),
      track_stock: true,
    });
    expect(large.option_values).toEqual({ Size: 'L' });

    const patched = await service.updateVariant(A.store, A.owner, large.id, {
      price: sgd(240),
      barcodes: ['8880000000127'],
    });
    expect(patched.price.amount).toBe(240);
    expect(patched.barcodes).toEqual(['8880000000127']);

    // duplicate combination via addVariant
    await expect(
      service.addVariant(A.store, A.owner, product.id, {
        option_values: { Size: 'L' },
        barcodes: [],
        price: sgd(220),
        track_stock: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await service.removeVariant(A.store, A.owner, large.id);
    const remaining = await service.get(A.store, product.id);
    expect(remaining.variants).toHaveLength(1);
    await expect(
      service.removeVariant(A.store, A.owner, remaining.variants[0]!.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to delete a variant with stock history', async () => {
    const product = await service.create(A.store, A.owner, {
      name: 'Counted',
      status: 'active',
      options: [{ name: 'Size', values: ['A', 'B'] }],
      variants: [
        { option_values: { Size: 'A' }, barcodes: [], price: sgd(100), track_stock: true, initial_stock: 3 },
        { option_values: { Size: 'B' }, barcodes: [], price: sgd(100), track_stock: true },
      ],
    });
    await expect(
      service.removeVariant(A.store, A.owner, product.variants[0]!.id),
    ).rejects.toBeInstanceOf(ConflictException);
    // ...but the movement-free sibling can go.
    await service.removeVariant(A.store, A.owner, product.variants[1]!.id);
  });
});

describe('update & archive', () => {
  it('updates product fields and archives via DELETE semantics', async () => {
    const product = await service.create(A.store, A.owner, {
      name: 'Rename Me',
      status: 'draft',
      options: [],
      variants: [{ option_values: {}, barcodes: [], price: sgd(500), track_stock: true }],
    });
    const updated = await service.update(A.store, A.owner, product.id, {
      name: 'Renamed',
      status: 'active',
      brand: 'HouseBrand',
    });
    expect(updated.name).toBe('Renamed');
    expect(updated.brand).toBe('HouseBrand');

    await service.archive(A.store, A.owner, product.id);
    const archived = await service.get(A.store, product.id);
    expect(archived.status).toBe('archived');
  });
});

describe('list', () => {
  it('searches by name, SKU, and exact barcode; excludes archived by default', async () => {
    const byName = await service.list(A.store, { limit: 50, search: 'Kopi' }, { limit: 50 });
    expect(byName.items.some((p) => p.name === 'Kopi O')).toBe(true);

    const bySku = await service.list(A.store, { limit: 50, search: 'TEE-M' }, { limit: 50 });
    expect(bySku.items.map((p) => p.name)).toContain('RetailOS Tee');

    const byBarcode = await service.list(
      A.store,
      { limit: 50, search: '8880000000028' },
      { limit: 50 },
    );
    expect(byBarcode.items.map((p) => p.name)).toContain('RetailOS Tee');

    const all = await service.list(A.store, { limit: 50 }, { limit: 50 });
    expect(all.items.every((p) => p.status !== 'archived')).toBe(true);

    const archived = await service.list(A.store, { limit: 50, status: 'archived' }, { limit: 50 });
    expect(archived.items.every((p) => p.status === 'archived')).toBe(true);
    expect(archived.items.length).toBeGreaterThan(0);
  });

  it('rolls up variant count, price range, and on-hand', async () => {
    const page = await service.list(A.store, { limit: 50, search: 'RetailOS Tee' }, { limit: 50 });
    const tee = page.items.find((p) => p.name === 'RetailOS Tee');
    expect(tee?.variant_count).toBe(2);
    expect(tee?.price_min?.amount).toBe(2500);
    expect(tee?.on_hand).toBe(12);
  });

  it('pages with a stable keyset cursor', async () => {
    const first = await service.list(A.store, { limit: 2 }, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.next_cursor).toBeTypeOf('string');
    const second = await service.list(
      A.store,
      { limit: 50 },
      { limit: 50, after: first.items[first.items.length - 1]!.id },
    );
    const firstIds = new Set(first.items.map((p) => p.id));
    expect(second.items.every((p) => !firstIds.has(p.id))).toBe(true);
  });
});

describe('permissions & tenant isolation', () => {
  it('cashier cannot mutate the catalog', async () => {
    await expect(
      service.create(A.store, A.cashier, {
        name: 'Nope',
        status: 'active',
        options: [],
        variants: [{ option_values: {}, barcodes: [], price: sgd(100), track_stock: true }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("store B cannot read or mutate store A's products; same barcode is fine cross-store", async () => {
    const aProduct = await service.create(A.store, A.owner, {
      name: 'A Exclusive',
      status: 'active',
      options: [],
      variants: [
        { option_values: {}, barcodes: ['8880000000202'], price: sgd(300), track_stock: true },
      ],
    });
    await expect(service.get(B.store, aProduct.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(B.store, B.owner, aProduct.id, { name: 'Stolen' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Barcode uniqueness is per store (FR-2.2) — B may reuse A's code.
    const bProduct = await service.create(B.store, B.owner, {
      name: 'B Product',
      status: 'active',
      options: [],
      variants: [
        { option_values: {}, barcodes: ['8880000000202'], price: sgd(300), track_stock: true },
      ],
    });
    expect(bProduct.variants[0]?.barcodes).toEqual(['8880000000202']);
  });

  it('initial stock without a location fails loudly (store B has none yet)', async () => {
    await expect(
      service.create(B.store, B.owner, {
        name: 'No Location Yet',
        status: 'active',
        options: [],
        variants: [
          { option_values: {}, barcodes: [], price: sgd(100), track_stock: true, initial_stock: 4 },
        ],
      }),
    ).rejects.toThrow(/location/i);
  });
});
