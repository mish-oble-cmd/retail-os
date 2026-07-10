/**
 * Product image upload flow (1A): presign is permission-gated and
 * store-scoped; product PATCH persists the returned URLs. Storage is the
 * adapter interface — a fake here, MinIO/S3 in dev/prod.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import type { ObjectStorage, PresignedUpload } from '../src/common/storage';
import { locations, roles, staff, stores, taxCategories } from '../src/db/schema';
import { ProductsService } from '../src/modules/catalog/products.service';
import { UploadsService } from '../src/modules/catalog/uploads.service';
import { createTestDb } from './pglite';

class FakeStorage implements ObjectStorage {
  readonly presigned: string[] = [];
  presignUpload(key: string, _contentType: string): Promise<PresignedUpload> {
    this.presigned.push(key);
    return Promise.resolve({
      upload_url: `https://fake.dev/upload/${key}`,
      key,
      public_url: this.publicUrl(key),
    });
  }
  publicUrl(key: string): string {
    return `https://cdn.fake.dev/${key}`;
  }
}

let db: Awaited<ReturnType<typeof createTestDb>>;
let uploads: UploadsService;
let products: ProductsService;
let storage: FakeStorage;

const A = {
  store: '01STOREAAAAAAAAAAAAAAAAAAA',
  ownerRole: '01ROLEAAAAAAAAAAAAAAAAAAAA',
  cashierRole: '01ROLEAAAAAAAAAAAAAAAAAAAC',
  owner: '01STAFFAAAAAAAAAAAAAAAAAAA',
  cashier: '01STAFFAAAAAAAAAAAAAAAAAAC',
  taxCategory: '01TAXCATAAAAAAAAAAAAAAAAAA',
  location: '01LOCAAAAAAAAAAAAAAAAAAAAA',
};

beforeAll(async () => {
  db = await createTestDb();
  const dbService = { tenants: db.tenants } as unknown as DbService;
  storage = new FakeStorage();
  uploads = new UploadsService(dbService, storage);
  products = new ProductsService(dbService);
  await db.tenants.dangerouslyCrossTenant('test seed', async (tx) => {
    await tx.insert(stores).values({ id: A.store, name: 'Store A', currency: 'SGD' });
    await tx.insert(roles).values([
      { id: A.ownerRole, storeId: A.store, name: 'Owner', permissions: { owner: true } },
      { id: A.cashierRole, storeId: A.store, name: 'Cashier', permissions: {} },
    ]);
    await tx.insert(staff).values([
      { id: A.owner, storeId: A.store, name: 'Owner A', roleId: A.ownerRole },
      { id: A.cashier, storeId: A.store, name: 'Cashier A', roleId: A.cashierRole },
    ]);
    await tx.insert(taxCategories).values({ id: A.taxCategory, storeId: A.store, name: 'Standard' });
    await tx.insert(locations).values({ id: A.location, storeId: A.store, name: 'Main' });
  });
});

afterAll(async () => {
  await db.close();
});

describe('presignProductImage', () => {
  it('issues a store-scoped key with the right extension', async () => {
    const result = await uploads.presignProductImage(A.store, A.owner, 'image/webp');
    expect(result.key).toMatch(
      new RegExp(`^stores/${A.store}/products/[0-9A-HJKMNP-TV-Z]{26}\\.webp$`),
    );
    expect(result.public_url).toBe(`https://cdn.fake.dev/${result.key}`);
    expect(storage.presigned).toContain(result.key);
  });

  it('refuses non-image content types before touching storage', async () => {
    const before = storage.presigned.length;
    await expect(
      uploads.presignProductImage(A.store, A.owner, 'application/pdf'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.presigned).toHaveLength(before);
  });

  it('is permission-gated like every catalog mutation', async () => {
    await expect(
      uploads.presignProductImage(A.store, A.cashier, 'image/png'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('persisting images on the product', () => {
  it('PATCH images replaces the ordered set', async () => {
    const product = await products.create(A.store, A.owner, {
      name: 'Pictured',
      status: 'active',
      options: [],
      variants: [{ option_values: {}, barcodes: [], price: { amount: 500 }, track_stock: true }],
    });
    const presigned = await uploads.presignProductImage(A.store, A.owner, 'image/jpeg');
    const updated = await products.update(A.store, A.owner, product.id, {
      images: [presigned.public_url],
    });
    expect(updated.images).toEqual([presigned.public_url]);
  });
});
