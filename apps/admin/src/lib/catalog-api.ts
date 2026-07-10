import { api } from './api';

/**
 * Typed wrappers over the catalog + settings endpoints (1A). Shapes mirror
 * the API resources 1:1 (snake_case JSON per api-design.md); components map
 * these to view models at the feature boundary (coding-standards.md §React).
 */

export interface MoneyResource {
  amount: number;
  currency: string;
}

export interface CategoryResource {
  id: string;
  name: string;
  parent_id: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

export interface OptionDefinition {
  name: string;
  values: string[];
}

export interface VariantResource {
  id: string;
  product_id: string;
  option_values: Record<string, string>;
  sku: string | null;
  barcodes: string[];
  price: MoneyResource;
  compare_at_price: MoneyResource | null;
  cost: MoneyResource | null;
  track_stock: boolean;
  on_hand: number;
}

export interface ProductResource {
  id: string;
  name: string;
  description: string | null;
  category_id: string | null;
  brand: string | null;
  images: string[];
  options: OptionDefinition[];
  tax_category_id: string;
  status: 'active' | 'draft' | 'archived';
  has_variants: boolean;
  variants: VariantResource[];
}

export interface ProductListItem {
  id: string;
  name: string;
  status: 'active' | 'draft' | 'archived';
  category_id: string | null;
  brand: string | null;
  image: string | null;
  has_variants: boolean;
  variant_count: number;
  price_min: MoneyResource | null;
  price_max: MoneyResource | null;
  on_hand: number;
  updated_at: string;
}

export interface ProductListPage {
  items: ProductListItem[];
  next_cursor: string | null;
  total: number;
  total_variants: number;
}

export interface VariantInput {
  option_values: Record<string, string>;
  sku?: string | null;
  barcodes: string[];
  price: { amount: number };
  cost?: { amount: number } | null;
  track_stock: boolean;
  initial_stock?: number;
}

export interface CreateProductInput {
  name: string;
  description?: string | null;
  category_id?: string | null;
  brand?: string | null;
  status: 'active' | 'draft';
  tax_category_id?: string;
  options: OptionDefinition[];
  variants: VariantInput[];
}

export interface UpdateProductInput {
  name?: string;
  description?: string | null;
  category_id?: string | null;
  brand?: string | null;
  status?: 'active' | 'draft' | 'archived';
  tax_category_id?: string;
  images?: string[];
}

export interface ImportReport {
  rows_total: number;
  products_created: number;
  variants_created: number;
  skipped: Array<{ row: number; reason: string }>;
}

export interface TaxCategoryResource {
  id: string;
  name: string;
}

export interface LocationResource {
  id: string;
  name: string;
  address: Record<string, string> | null;
  timezone: string;
  active: boolean;
}

export interface GridTile {
  row: number;
  col: number;
  kind: 'product' | 'category';
  ref_id: string;
  label?: string;
}

export interface GridLayout {
  columns: number;
  tiles: GridTile[];
}

export interface RegisterResource {
  id: string;
  location_id: string;
  name: string;
  active: boolean;
  grid_layout: Partial<GridLayout> | null;
  pending_activation: { expires_at: string } | null;
}

export interface IssuedActivationCode {
  code: string;
  expires_at: string;
}

const V1 = '/api/v1';

// why as: dynamic segments and query strings are never literal keys of the
// generated paths type; these wrapper functions are the typed surface instead.
const p = (path: string) => path as import('@retailos/api-client').ApiPath;

export const catalogApi = {
  listProducts: (params: { search?: string; status?: string; category_id?: string; cursor?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.status) query.set('status', params.status);
    if (params.category_id) query.set('category_id', params.category_id);
    if (params.cursor) query.set('cursor', params.cursor);
    query.set('limit', String(params.limit ?? 50));
    return api.get<ProductListPage>(p(`${V1}/products?${query.toString()}`));
  },
  getProduct: (id: string) => api.get<ProductResource>(p(`${V1}/products/${id}`)),
  createProduct: (input: CreateProductInput) =>
    api.post<ProductResource>(p(`${V1}/products`), input),
  updateProduct: (id: string, input: UpdateProductInput) =>
    api.patch<ProductResource>(p(`${V1}/products/${id}`), input),
  archiveProduct: (id: string) => api.delete(p(`${V1}/products/${id}`)),
  addVariant: (productId: string, input: VariantInput) =>
    api.post<VariantResource>(p(`${V1}/products/${productId}/variants`), input),
  updateVariant: (
    id: string,
    input: Partial<Pick<VariantInput, 'sku' | 'barcodes' | 'price' | 'cost' | 'track_stock'>>,
  ) => api.patch<VariantResource>(p(`${V1}/variants/${id}`), input),
  deleteVariant: (id: string) => api.delete(p(`${V1}/variants/${id}`)),
  importCsv: (csv: string) => api.post<ImportReport>(p(`${V1}/products/import`), { csv }),
  exportCsv: () => api.getText(p(`${V1}/products/export`)),
  presignImage: (contentType: string) =>
    api.post<{ upload_url: string; key: string; public_url: string }>(
      p(`${V1}/uploads/product-image`),
      { content_type: contentType },
    ),

  listCategories: () => api.get<{ items: CategoryResource[] }>(p(`${V1}/categories`)),
  createCategory: (input: { name: string; parent_id?: string | null; sort?: number }) =>
    api.post<CategoryResource>(p(`${V1}/categories`), input),
  updateCategory: (id: string, input: { name?: string; parent_id?: string | null; sort?: number }) =>
    api.patch<CategoryResource>(p(`${V1}/categories/${id}`), input),
  deleteCategory: (id: string) => api.delete(p(`${V1}/categories/${id}`)),

  listTaxCategories: () => api.get<{ items: TaxCategoryResource[] }>(p(`${V1}/tax-categories`)),
};

export const settingsApi = {
  listLocations: () => api.get<{ items: LocationResource[] }>(p(`${V1}/locations`)),
  createLocation: (input: { name: string }) =>
    api.post<LocationResource>(p(`${V1}/locations`), input),
  updateLocation: (id: string, input: { name?: string; active?: boolean }) =>
    api.patch<LocationResource>(p(`${V1}/locations/${id}`), input),

  listRegisters: () => api.get<{ items: RegisterResource[] }>(p(`${V1}/registers`)),
  createRegister: (input: { location_id: string; name: string }) =>
    api.post<RegisterResource>(p(`${V1}/registers`), input),
  updateRegister: (
    id: string,
    input: { name?: string; active?: boolean; grid_layout?: GridLayout },
  ) => api.patch<RegisterResource>(p(`${V1}/registers/${id}`), input),
  issueActivationCode: (registerId: string) =>
    api.post<IssuedActivationCode>(p(`${V1}/registers/${registerId}/activation-codes`)),
  revokeActivationCode: (registerId: string) =>
    api.delete(p(`${V1}/registers/${registerId}/activation-codes`)),
};
