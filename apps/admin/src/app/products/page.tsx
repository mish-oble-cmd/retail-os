'use client';

import { Badge, Button, Input, Modal, MoneyText } from '@retailos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import {
  catalogApi,
  type ImportReport,
  type ProductListItem,
} from '../../lib/catalog-api';

const PAGE_SIZE = 50;

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  // Cursor stack: push on Next, pop on Prev — keyset pagination has no page numbers.
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const cursor = cursorStack[cursorStack.length - 1];
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importedFileName, setImportedFileName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: catalogApi.listCategories,
  });
  const page = useQuery({
    queryKey: ['products', { search: debouncedSearch, status, categoryId, cursor }],
    queryFn: () =>
      catalogApi.listProducts({
        search: debouncedSearch || undefined,
        status: status || undefined,
        category_id: categoryId || undefined,
        cursor,
        limit: PAGE_SIZE,
      }),
  });

  const importMutation = useMutation({
    mutationFn: catalogApi.importCsv,
    onSuccess: (report) => {
      setImportReport(report);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setCursorStack([]);
      setDebouncedSearch(value.trim());
    }, 250);
  }

  async function onImportFile(file: File) {
    setImportedFileName(file.name);
    importMutation.mutate(await file.text());
  }

  async function onExport() {
    const csv = await catalogApi.exportCsv();
    downloadText(csv, 'products.csv');
  }

  const categoryName = new Map(
    (categories.data?.items ?? []).map((category) => [category.id, category.name]),
  );
  const items = page.data?.items ?? [];

  return (
    <AppShell
      title="Products"
      topbar={
        <>
          <span className="text-body-sm text-ink-muted">
            {page.data ? `${page.data.total} products · ${page.data.total_variants} variants` : ''}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportFile(file);
                event.target.value = '';
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
              {importMutation.isPending ? 'Importing…' : 'Import CSV'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void onExport()}>
              Export
            </Button>
            <Link href="/products/new">
              <Button size="sm">Add product</Button>
            </Link>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="w-80">
            <Input
              placeholder="Search name, SKU, or barcode…"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              aria-label="Search products"
            />
          </div>
          <select
            className="h-9 rounded border border-border bg-surface px-3 font-ui text-body-sm text-ink"
            value={categoryId}
            onChange={(event) => {
              setCategoryId(event.target.value);
              setCursorStack([]);
            }}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {(categories.data?.items ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded border border-border bg-surface px-3 font-ui text-body-sm text-ink"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setCursorStack([]);
            }}
            aria-label="Filter by status"
          >
            <option value="">Active + draft</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>

        {importMutation.isError ? (
          <p className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-body-sm text-danger">
            Import failed: {(importMutation.error as Error).message}
          </p>
        ) : null}

        <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <table className="w-full border-collapse font-ui text-body-sm">
            <thead>
              <tr>
                <Th>Product</Th>
                <Th>Category</Th>
                <Th>SKU</Th>
                <Th align="right">Price</Th>
                <Th align="right">Stock</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  categoryName={
                    product.category_id ? (categoryName.get(product.category_id) ?? '—') : '—'
                  }
                />
              ))}
              {items.length === 0 && !page.isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-ink-muted">
                    {debouncedSearch || status || categoryId ? (
                      'Nothing matches these filters.'
                    ) : (
                      <span>
                        No products yet —{' '}
                        <Link href="/products/new" className="text-primary underline">
                          add your first product
                        </Link>{' '}
                        or import a CSV.
                      </span>
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-body-sm text-ink-muted">
            <span>
              {page.data
                ? `Showing ${items.length} of ${page.data.total}${status === 'archived' ? ' archived' : ''}`
                : 'Loading…'}
            </span>
            <span className="flex gap-3">
              <button
                type="button"
                className="disabled:opacity-40"
                disabled={cursorStack.length === 0}
                onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
              >
                ‹ Prev
              </button>
              <button
                type="button"
                className="font-semibold text-ink disabled:opacity-40"
                disabled={!page.data?.next_cursor}
                onClick={() => {
                  const next = page.data?.next_cursor;
                  if (next) setCursorStack((stack) => [...stack, next]);
                }}
              >
                Next ›
              </button>
            </span>
          </div>
        </div>
      </div>

      <Modal
        open={importReport !== null}
        onClose={() => setImportReport(null)}
        title="Import finished"
        footer={
          <>
            {importReport && importReport.skipped.length > 0 ? (
              <Button
                variant="secondary"
                onClick={() =>
                  downloadText(skippedRowsCsv(importReport), 'skipped-rows.csv')
                }
              >
                Download {importReport.skipped.length} skipped rows (CSV)
              </Button>
            ) : null}
            <Button onClick={() => setImportReport(null)}>Done — view products</Button>
          </>
        }
      >
        {importReport ? (
          <div className="flex flex-col gap-4">
            <p className="text-body-sm text-ink-muted">
              {importedFileName} · {importReport.rows_total} rows · skipped rows were not imported
              — fix them and re-import just those rows
            </p>
            <div className="flex gap-3">
              <Tally value={importReport.products_created} label="Products added" />
              <Tally
                value={importReport.skipped.length}
                label="Rows skipped"
                danger={importReport.skipped.length > 0}
              />
            </div>
            {importReport.skipped.length > 0 ? (
              <div className="max-h-64 overflow-auto rounded border border-border">
                <table className="w-full border-collapse text-body-sm">
                  <thead>
                    <tr>
                      <Th>Row</Th>
                      <Th>Problem</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.skipped.map((skip) => (
                      <tr key={skip.row} className="border-t border-border">
                        <td className="w-16 px-3 py-2 font-money">{skip.row}</td>
                        <td className="px-3 py-2">{skip.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`border-b border-border px-3 py-2.5 text-caption font-semibold uppercase tracking-wide text-ink-muted ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function ProductRow({
  product,
  categoryName,
}: {
  product: ProductListItem;
  categoryName: string;
}) {
  const initials = product.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-bg">
      <td className="px-3 py-2">
        <Link href={`/products/${product.id}`} className="flex items-center gap-2.5">
          {product.image ? (
            <img src={product.image} alt="" className="h-8 w-8 flex-none rounded-md object-cover" />
          ) : (
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-bg text-caption font-semibold text-primary">
              {initials}
            </span>
          )}
          <span>
            <span className="block font-medium text-ink">{product.name}</span>
            {product.has_variants ? (
              <span className="block text-caption text-ink-muted">
                {product.variant_count} variants
              </span>
            ) : null}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2 text-ink">{categoryName}</td>
      <td className="px-3 py-2 font-money text-caption text-ink-muted">—</td>
      <td className="px-3 py-2 text-right">
        {product.price_min ? (
          <span className="font-money tabular-nums">
            <MoneyText amount={product.price_min.amount} currency={product.price_min.currency} />
            {product.price_max && product.price_max.amount !== product.price_min.amount ? (
              <>
                –<MoneyText amount={product.price_max.amount} currency={product.price_max.currency} />
              </>
            ) : null}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td
        className={`px-3 py-2 text-right font-money tabular-nums ${product.on_hand < 0 ? 'font-semibold text-danger' : product.on_hand <= 5 ? 'font-semibold text-warning' : ''}`}
      >
        {product.on_hand}
      </td>
      <td className="px-3 py-2">
        <Badge
          tone={
            product.status === 'active'
              ? 'success'
              : product.status === 'archived'
                ? 'danger'
                : 'neutral'
          }
        >
          {product.status[0]?.toUpperCase() + product.status.slice(1)}
        </Badge>
      </td>
    </tr>
  );
}

function Tally({ value, label, danger }: { value: number; label: string; danger?: boolean }) {
  return (
    <div
      className={`flex-1 rounded border px-4 py-3 ${danger ? 'border-danger/40' : 'border-border'}`}
    >
      <p className={`font-money text-h2 font-semibold ${danger ? 'text-danger' : 'text-ink'}`}>
        {value}
      </p>
      <p className="text-caption font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
    </div>
  );
}

function downloadText(text: string, filename: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function skippedRowsCsv(report: ImportReport): string {
  const lines = [
    'row,reason',
    ...report.skipped.map((skip) => `${skip.row},"${skip.reason.replaceAll('"', '""')}"`),
  ];
  return lines.join('\n') + '\n';
}
