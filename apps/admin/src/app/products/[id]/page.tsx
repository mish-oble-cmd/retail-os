'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { ProductEditor } from '../../../components/product-editor';
import { catalogApi } from '../../../lib/catalog-api';

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const product = useQuery({
    queryKey: ['product', params.id],
    queryFn: () => catalogApi.getProduct(params.id),
  });

  return (
    <AppShell title="Products">
      {product.isLoading ? (
        <p className="text-ink-muted">Loading…</p>
      ) : product.data ? (
        // key: remount the editor when a fresh copy of the product arrives
        <ProductEditor key={product.data.id + product.dataUpdatedAt} product={product.data} />
      ) : (
        <p className="text-danger">Product not found.</p>
      )}
    </AppShell>
  );
}
