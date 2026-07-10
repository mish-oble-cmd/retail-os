'use client';

import { Badge, Button, Input } from '@retailos/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ApiError } from '@retailos/api-client';
import {
  catalogApi,
  type OptionDefinition,
  type ProductResource,
  type VariantInput,
} from '../lib/catalog-api';

/**
 * ADM-04 product editor. Create mode edits the options matrix and generates
 * variant rows; edit mode keeps the matrix fixed (matrix changes are a Phase 2
 * concern) and PATCHes product fields + changed variants. Money inputs parse
 * exact decimal strings to integer minor units — floats never touch amounts.
 */

interface VariantDraft {
  /** Present when the row exists server-side. */
  id?: string;
  optionValues: Record<string, string>;
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  initialStock: string;
  onHand?: number;
}

export function parseMajorToMinor(value: string): number | null {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1] ?? '0') * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function formatMinorToMajor(amount: number): string {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, '0')}`;
}

function comboKey(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}:${value}`)
    .sort()
    .join('|');
}

function expandCombos(options: OptionDefinition[]): Array<Record<string, string>> {
  if (options.length === 0) return [{}];
  return options.reduce<Array<Record<string, string>>>(
    (combos, option) =>
      combos.flatMap((combo) => option.values.map((value) => ({ ...combo, [option.name]: value }))),
    [{}],
  );
}

function draftFromProduct(product: ProductResource): VariantDraft[] {
  return product.variants.map((variant) => ({
    id: variant.id,
    optionValues: variant.option_values,
    sku: variant.sku ?? '',
    barcode: variant.barcodes[0] ?? '',
    price: formatMinorToMajor(variant.price.amount),
    cost: variant.cost ? formatMinorToMajor(variant.cost.amount) : '',
    initialStock: '',
    onHand: variant.on_hand,
  }));
}

export function ProductEditor({ product }: { product?: ProductResource }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isCreate = product === undefined;

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [categoryId, setCategoryId] = useState(product?.category_id ?? '');
  const [taxCategoryId, setTaxCategoryId] = useState(product?.tax_category_id ?? '');
  const [status, setStatus] = useState<'active' | 'draft' | 'archived'>(
    product?.status ?? 'active',
  );
  const [options, setOptions] = useState<OptionDefinition[]>(product?.options ?? []);
  const [variants, setVariants] = useState<VariantDraft[]>(
    product ? draftFromProduct(product) : [emptyDraft()],
  );
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [errors, setErrors] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const imageInput = useRef<HTMLInputElement>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: catalogApi.listCategories });
  const taxCategories = useQuery({
    queryKey: ['tax-categories'],
    queryFn: catalogApi.listTaxCategories,
  });

  function emptyDraft(): VariantDraft {
    return { optionValues: {}, sku: '', barcode: '', price: '', cost: '', initialStock: '' };
  }

  /** Create mode: option edits regenerate the matrix, keeping typed-in rows by combo. */
  function updateOptions(next: OptionDefinition[]) {
    const cleaned = next
      .map((option) => ({ ...option, name: option.name, values: option.values.filter(Boolean) }))
      .filter((option) => option.name.trim() !== '' || option.values.length > 0);
    setOptions(cleaned);
    const usable = cleaned.filter((option) => option.name.trim() !== '' && option.values.length > 0);
    const combos = expandCombos(usable);
    if (combos.length > 250) {
      setErrors(['That option set makes more than 250 variants (FR-2.2 limit)']);
      return;
    }
    setVariants((current) => {
      const byCombo = new Map(current.map((draft) => [comboKey(draft.optionValues), draft]));
      return combos.map(
        (combo) => byCombo.get(comboKey(combo)) ?? { ...emptyDraft(), optionValues: combo },
      );
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      const { input, variantPatches } = buildPayload();
      if (isCreate) {
        return catalogApi.createProduct(input);
      }
      const updated = await catalogApi.updateProduct(product.id, {
        name,
        description: description || null,
        brand: brand || null,
        category_id: categoryId || null,
        ...(taxCategoryId ? { tax_category_id: taxCategoryId } : {}),
        status,
        images,
      });
      for (const patch of variantPatches) {
        await catalogApi.updateVariant(patch.id, patch.input);
      }
      return updated;
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      router.push(isCreate ? `/products/${saved.id}` : '/products');
    },
    onError: (error) => {
      if (error instanceof ValidationHalt) return; // field-level messages already set
      setErrors([
        error instanceof ApiError ? (error.problem.detail ?? error.problem.title) : String(error),
      ]);
    },
  });

  function buildPayload(): {
    input: Parameters<typeof catalogApi.createProduct>[0];
    variantPatches: Array<{ id: string; input: Parameters<typeof catalogApi.updateVariant>[1] }>;
  } {
    const problems: string[] = [];
    const perRow: Record<string, string> = {};
    if (!name.trim()) problems.push('Product name is required');

    const variantInputs: VariantInput[] = [];
    const variantPatches: Array<{
      id: string;
      input: Parameters<typeof catalogApi.updateVariant>[1];
    }> = [];
    for (const draft of variants) {
      const key = comboKey(draft.optionValues);
      const price = parseMajorToMinor(draft.price);
      if (price === null) {
        perRow[key] = 'Every variant needs a price';
        continue;
      }
      const cost = draft.cost.trim() === '' ? null : parseMajorToMinor(draft.cost);
      if (cost === null && draft.cost.trim() !== '') {
        perRow[key] = 'Cost must be an amount like 74.00';
        continue;
      }
      if (draft.id) {
        variantPatches.push({
          id: draft.id,
          input: {
            sku: draft.sku.trim() || null,
            barcodes: draft.barcode.trim() ? [draft.barcode.trim()] : [],
            price: { amount: price },
            cost: cost === null ? null : { amount: cost },
          },
        });
      } else {
        const initialStock = draft.initialStock.trim();
        variantInputs.push({
          option_values: draft.optionValues,
          sku: draft.sku.trim() || null,
          barcodes: draft.barcode.trim() ? [draft.barcode.trim()] : [],
          price: { amount: price },
          cost: cost === null ? null : { amount: cost },
          track_stock: true,
          ...(initialStock !== '' ? { initial_stock: Number(initialStock) } : {}),
        });
      }
    }

    setRowErrors(perRow);
    if (problems.length > 0 || Object.keys(perRow).length > 0) {
      setErrors(problems);
      throw new ValidationHalt(
        `${problems.length + Object.keys(perRow).length} things to fix before saving`,
      );
    }
    setErrors([]);

    const usableOptions = options.filter(
      (option) => option.name.trim() !== '' && option.values.length > 0,
    );
    return {
      input: {
        name: name.trim(),
        description: description || null,
        brand: brand || null,
        category_id: categoryId || null,
        ...(taxCategoryId ? { tax_category_id: taxCategoryId } : {}),
        status: status === 'archived' ? 'active' : status,
        options: usableOptions,
        variants: variantInputs,
      },
      variantPatches,
    };
  }

  async function onPickImage(file: File) {
    try {
      const presigned = await catalogApi.presignImage(file.type);
      const put = await fetch(presigned.upload_url, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setImages((current) => [...current, presigned.public_url]);
    } catch (error) {
      setErrors([error instanceof ApiError ? error.problem.title : String(error)]);
    }
  }

  const optionNames = useMemo(
    () => options.filter((option) => option.name.trim() !== '').map((option) => option.name),
    [options],
  );
  const fixCount = errors.length + Object.keys(rowErrors).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-h3 font-semibold text-ink">{isCreate ? 'New product' : name || '—'}</h1>
        <Badge tone={status === 'active' ? 'success' : status === 'archived' ? 'danger' : 'neutral'}>
          {status[0]?.toUpperCase() + status.slice(1)}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => router.push('/products')}>
            Discard changes
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save product'}
          </Button>
        </div>
      </div>

      {fixCount > 0 ? (
        <div className="flex items-center gap-2 rounded border border-danger/40 bg-danger/5 px-4 py-3 text-body-sm text-ink">
          <span>
            <b>
              {fixCount} thing{fixCount === 1 ? '' : 's'} to fix before saving
            </b>{' '}
            — the fields are marked below. Nothing has been saved yet.
            {errors.length > 0 ? ` ${errors.join(' · ')}` : ''}
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-[2fr_1fr] items-start gap-4">
        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-body font-semibold text-ink">Details</h3>
            <div className="flex flex-col gap-3">
              <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} />
              <div className="flex flex-col gap-1">
                <label className="font-ui text-body-sm font-medium text-ink" htmlFor="description">
                  Description — shows on the web receipt
                </label>
                <textarea
                  id="description"
                  className="min-h-20 w-full rounded border border-border bg-surface px-3 py-2 font-ui text-body-sm text-ink"
                  value={description ?? ''}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-body font-semibold text-ink">Options &amp; variants</h3>
            {isCreate ? (
              <OptionsEditor options={options} onChange={updateOptions} />
            ) : (
              <p className="mb-3 text-caption text-ink-muted">
                {options.length > 0
                  ? `Options: ${options.map((option) => `${option.name} (${option.values.join(' / ')})`).join(' · ')} — matrix changes arrive in Phase 2`
                  : 'Simple product — one variant'}
              </p>
            )}
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th>SKU</Th>
                  <Th>Barcode</Th>
                  <Th align="right">Price</Th>
                  <Th align="right">Cost</Th>
                  <Th align="right">{isCreate ? 'Initial stock' : 'Stock'}</Th>
                </tr>
              </thead>
              <tbody>
                {variants.map((draft) => {
                  const key = comboKey(draft.optionValues);
                  const label =
                    optionNames.length > 0
                      ? optionNames.map((option) => draft.optionValues[option]).join(' / ')
                      : 'Default';
                  const rowError = rowErrors[key];
                  return (
                    <tr key={key || 'default'} className="border-t border-border align-top">
                      <td className="px-2 py-2 font-medium text-ink">{label}</td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`SKU for ${label}`}
                          className="font-money"
                          value={draft.sku}
                          onChange={(event) => patchDraft(key, { sku: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`Barcode for ${label}`}
                          className="font-money"
                          value={draft.barcode}
                          onChange={(event) => patchDraft(key, { barcode: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`Price for ${label}`}
                          className="text-right font-money"
                          placeholder="0.00"
                          value={draft.price}
                          error={rowError}
                          onChange={(event) => patchDraft(key, { price: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          aria-label={`Cost for ${label}`}
                          className="text-right font-money"
                          placeholder="0.00"
                          value={draft.cost}
                          onChange={(event) => patchDraft(key, { cost: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        {isCreate ? (
                          <Input
                            aria-label={`Initial stock for ${label}`}
                            className="text-right font-money"
                            placeholder="0"
                            value={draft.initialStock}
                            onChange={(event) =>
                              patchDraft(key, { initialStock: event.target.value })
                            }
                          />
                        ) : (
                          <span className="block px-3 py-2 text-right font-money tabular-nums">
                            {draft.onHand ?? 0}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <section className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-body font-semibold text-ink">Images</h3>
            <input
              ref={imageInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onPickImage(file);
                event.target.value = '';
              }}
            />
            <div className="flex flex-wrap gap-2">
              {images.map((url) => (
                <span key={url} className="relative">
                  <img src={url} alt="" className="h-20 w-20 rounded-md border border-border object-cover" />
                  <button
                    type="button"
                    aria-label="Remove image"
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] text-white"
                    onClick={() => setImages((current) => current.filter((image) => image !== url))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-border text-body-sm text-ink-muted hover:border-primary hover:text-primary"
                onClick={() => imageInput.current?.click()}
              >
                + Add
              </button>
            </div>
            {isCreate ? (
              <p className="mt-2 text-caption text-ink-muted">
                Save the product first to attach uploaded images.
              </p>
            ) : null}
          </section>

          <section className="rounded-card border border-border bg-surface p-4 shadow-card">
            <h3 className="mb-3 text-body font-semibold text-ink">Organization</h3>
            <div className="flex flex-col gap-3">
              <SelectField
                label="Category"
                value={categoryId ?? ''}
                onChange={setCategoryId}
                options={[
                  { value: '', label: 'No category' },
                  ...(categories.data?.items ?? []).map((category) => ({
                    value: category.id,
                    label: category.name,
                  })),
                ]}
              />
              <Input label="Brand" value={brand ?? ''} onChange={(event) => setBrand(event.target.value)} />
              <SelectField
                label="Tax category"
                value={taxCategoryId}
                onChange={setTaxCategoryId}
                options={[
                  { value: '', label: 'Store default' },
                  ...(taxCategories.data?.items ?? []).map((taxCategory) => ({
                    value: taxCategory.id,
                    label: taxCategory.name,
                  })),
                ]}
              />
              <SelectField
                label="Status"
                value={status}
                onChange={(value) => setStatus(value as typeof status)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'draft', label: 'Draft' },
                  ...(isCreate ? [] : [{ value: 'archived', label: 'Archived' }]),
                ]}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  function patchDraft(key: string, patch: Partial<VariantDraft>) {
    setVariants((current) =>
      current.map((draft) => (comboKey(draft.optionValues) === key ? { ...draft, ...patch } : draft)),
    );
  }
}

class ValidationHalt extends Error {}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`pb-2 text-caption font-semibold uppercase tracking-wide text-ink-muted ${align === 'right' ? 'text-right' : 'text-left'} px-2`}
    >
      {children}
    </th>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-ui text-body-sm font-medium text-ink">{label}</label>
      <select
        className="h-9 w-full rounded border border-border bg-surface px-3 font-ui text-body-sm text-ink"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Up to 3 options; values entered as comma-separated tags (mockup: tag chips). */
function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionDefinition[];
  onChange: (options: OptionDefinition[]) => void;
}) {
  const rows: OptionDefinition[] = [...options];
  if (rows.length < 3) rows.push({ name: '', values: [] });

  return (
    <div className="mb-4 flex flex-col gap-2">
      {rows.map((option, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="w-40">
            <Input
              label={`Option ${index + 1}`}
              placeholder="e.g. Size"
              value={option.name}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...option, name: event.target.value };
                onChange(next.filter((entry) => entry.name.trim() !== '' || entry.values.length > 0));
              }}
            />
          </div>
          <div className="flex-1">
            <Input
              label={index === 0 ? 'Values — comma separated, up to 3 options, 250 variants max' : 'Values'}
              placeholder="e.g. 100g, 200g, 400g"
              value={option.values.join(', ')}
              onChange={(event) => {
                const values = event.target.value
                  .split(',')
                  .map((value) => value.trim())
                  .filter((value, valueIndex, all) => value !== '' && all.indexOf(value) === valueIndex);
                const next = [...rows];
                next[index] = { ...option, values };
                onChange(next.filter((entry) => entry.name.trim() !== '' || entry.values.length > 0));
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
