'use client';

import { AppShell } from '../../../components/app-shell';
import { ProductEditor } from '../../../components/product-editor';

export default function NewProductPage() {
  return (
    <AppShell title="Products">
      <ProductEditor />
    </AppShell>
  );
}
