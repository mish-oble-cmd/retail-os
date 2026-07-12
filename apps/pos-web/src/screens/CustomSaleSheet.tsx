import { Button, Modal, MoneyText, NumberPad } from '@retailos/ui';
import type { TaxRateRow } from '@retailos/sync';
import { useState } from 'react';
import type { TaxCategoryOption } from '../lib/device';

/**
 * POS-13 custom sale sheet. Ad-hoc line — name + price (NumberPad, minor units
 * right-to-left) + tax category. Flagged as a custom sale in reports (FR-1.3).
 * Zero price is blocked: free items must use a 100% discount so the register
 * tape keeps an audit trail.
 */

interface CustomSaleSheetProps {
  currency: string;
  taxCategories: TaxCategoryOption[];
  onAdd: (input: { name: string; unitPriceAmount: number; taxRates: TaxRateRow[] }) => void;
  onClose: () => void;
}

export function CustomSaleSheet({ currency, taxCategories, onAdd, onClose }: CustomSaleSheetProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [taxCategoryId, setTaxCategoryId] = useState(taxCategories[0]?.id ?? '');

  const selected = taxCategories.find((c) => c.id === taxCategoryId);
  const canAdd = name.trim().length > 0 && price > 0;

  return (
    <Modal
      open
      title="Custom sale"
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onAdd({ name: name.trim(), unitPriceAmount: price, taxRates: selected?.rates ?? [] })}
            disabled={!canAdd}
          >
            Add to cart · <MoneyText amount={price} currency={currency} className="text-white" />
          </Button>
        </>
      }
    >
      <p className="mb-3 text-body-sm text-ink-muted">Ad-hoc item — flagged as “custom sale” in reports.</p>
      <div className="grid grid-cols-[1fr_auto] gap-6">
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-body-sm text-ink-muted">Item name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Gift basket assembly fee"
              className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="text-body-sm text-ink-muted">Price</label>
            <div
              className={
                'mt-1 rounded border px-4 py-3 text-right font-money text-h2 ' +
                (price === 0 ? 'border-danger text-ink-muted' : 'border-border text-ink')
              }
            >
              <MoneyText amount={price} currency={currency} />
            </div>
            {price === 0 && (
              <p className="mt-1 text-caption text-danger">
                Enter a price — free items need a 100% discount instead, so the register tape stays honest.
              </p>
            )}
          </div>
          <div>
            <label className="text-body-sm text-ink-muted">Tax category</label>
            <div className="mt-1 flex flex-col gap-2">
              {taxCategories.map((cat) => {
                const totalBp = cat.rates.reduce((sum, r) => sum + r.rateBp, 0);
                return (
                  <button
                    key={cat.id}
                    onClick={() => setTaxCategoryId(cat.id)}
                    className={
                      'flex items-center gap-2 rounded border px-3 py-2 text-left text-body ' +
                      (taxCategoryId === cat.id ? 'border-primary bg-primary/5 text-ink' : 'border-border text-ink')
                    }
                  >
                    <span className={'h-3.5 w-3.5 rounded-full border-2 ' + (taxCategoryId === cat.id ? 'border-primary bg-primary' : 'border-border')} />
                    {cat.name}
                    <span className="ml-auto text-caption text-ink-muted">
                      {totalBp > 0 ? `${totalBp / 100}% included` : '0%'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <NumberPad value={price} onChange={setPrice} className="w-56" />
      </div>
    </Modal>
  );
}
