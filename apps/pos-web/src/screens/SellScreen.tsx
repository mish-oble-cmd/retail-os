import { Button, MoneyText } from '@retailos/ui';
import {
  listCategories,
  listSellableVariants,
  lookupBarcode,
  searchSellableVariants,
  taxRatesByCategory,
  type CategoryRow,
  type SellableVariant,
  type SqlDriver,
  type StoreMeta,
  type TaxRateRow,
} from '@retailos/sync';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UseCart } from '../lib/cart';

/**
 * POS-03 Sell screen. Reads catalog from the device mirror, keeps a barcode
 * keyboard-wedge focus trap on the search field, and delegates all money math
 * to the cart controller (`@retailos/domain`). Charge is the single dominant
 * action; Park/Discount/Custom sit deliberately apart.
 */

interface SellScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  staff: { id: string; name: string };
  cart: UseCart;
  parkedCount: number;
  queuedFacts: number;
  onLock: () => void;
  onCharge: () => void;
  onPark: () => void;
  onOpenParked: () => void;
  onOpenDiscount: () => void;
  onOpenCustomSale: () => void;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function SellScreen({
  driver,
  store,
  staff,
  cart,
  parkedCount,
  queuedFacts,
  onLock,
  onCharge,
  onPark,
  onOpenParked,
  onOpenDiscount,
  onOpenCustomSale,
}: SellScreenProps) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grid, setGrid] = useState<SellableVariant[]>([]);
  const [ratesByCategory, setRatesByCategory] = useState<Map<string, TaxRateRow[]>>(new Map());
  const searchRef = useRef<HTMLInputElement>(null);

  // Load static reference data once.
  useEffect(() => {
    setCategories(listCategories(driver));
    setRatesByCategory(taxRatesByCategory(driver));
  }, [driver]);

  // Grid reacts to category + search.
  useEffect(() => {
    const term = search.trim();
    if (term) {
      setGrid(searchSellableVariants(driver, term));
    } else {
      setGrid(listSellableVariants(driver, activeCategory ?? undefined));
    }
  }, [driver, activeCategory, search]);

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);
  useEffect(() => {
    focusSearch();
  }, [focusSearch]);

  const ratesFor = useCallback(
    (variant: SellableVariant) => ratesByCategory.get(variant.taxCategoryId) ?? [],
    [ratesByCategory],
  );

  const addVariant = useCallback(
    (variant: SellableVariant) => {
      cart.addVariant(variant, ratesFor(variant));
      focusSearch();
    },
    [cart, ratesFor, focusSearch],
  );

  // Enter = barcode scan (wedge) → exact match adds to cart and clears; a
  // non-matching term just stays as a search filter.
  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const code = search.trim();
    if (!code) return;
    const hit = lookupBarcode(driver, code);
    if (hit) {
      addVariant(hit);
      setSearch('');
    }
  };

  const online = typeof navigator === 'undefined' ? true : navigator.onLine;

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Top bar */}
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">{store.name}</p>
          <p className="text-caption text-ink-muted">Register 2 · Poblacion branch</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SyncPill online={online} queued={queuedFacts} />
          <span className="flex items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-body-sm font-medium text-ink">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-caption font-semibold text-white">
              {initials(staff.name)}
            </span>
            {staff.name}
          </span>
          <Button variant="secondary" size="pos" onClick={onLock}>
            Lock
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Catalog side */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <div className="flex items-center gap-3 rounded border-2 border-primary bg-surface px-4 shadow-[0_0_0_3px_rgba(26,77,46,0.15)]">
            <svg className="h-5 w-5 flex-none stroke-current text-ink-muted" viewBox="0 0 24 24" fill="none" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              onBlur={() => setTimeout(focusSearch, 0)}
              placeholder="Scan barcode or search products…"
              aria-label="Scan barcode or search products"
              className="h-13 min-h-touch-pos flex-1 bg-transparent py-3 text-pos-body text-ink outline-none placeholder:text-ink-muted"
            />
            <span className="rounded border border-border px-1.5 py-0.5 text-caption text-ink-muted">F2</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <CategoryChip label="All" active={activeCategory === null} onClick={() => setActiveCategory(null)} />
            {categories.map((cat) => (
              <CategoryChip
                key={cat.id}
                label={cat.name}
                active={activeCategory === cat.id}
                onClick={() => setActiveCategory(cat.id)}
              />
            ))}
          </div>

          <div className="grid min-h-0 flex-1 auto-rows-[108px] grid-cols-[repeat(auto-fill,minmax(180px,1fr))] content-start gap-2.5 overflow-auto">
            {grid.map((variant) => (
              <ProductTile
                key={variant.variantId}
                variant={variant}
                currency={store.currency}
                onClick={() => addVariant(variant)}
              />
            ))}
            {grid.length === 0 && (
              <p className="col-span-full mt-8 text-center text-pos-body text-ink-muted">No products match “{search}”.</p>
            )}
          </div>
        </div>

        {/* Cart panel */}
        <aside className="flex w-[400px] flex-none flex-col border-l border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border p-3">
            <button className="flex items-center gap-2 rounded-full border border-dashed border-border px-3.5 py-2 text-body-sm text-ink-muted">
              ＋ Add customer
            </button>
            <button
              onClick={cart.lines.length > 0 ? onPark : onOpenParked}
              className="ml-auto min-h-touch-pos rounded border border-border bg-surface px-4 text-body font-medium text-ink"
            >
              {cart.lines.length > 0 ? 'Park cart' : `Parked (${parkedCount})`}
            </button>
          </div>

          {cart.lines.length === 0 ? (
            <EmptyCart />
          ) : (
            <div className="flex-1 overflow-auto py-1">
              {cart.totals.lines.map((lineTotal, i) => {
                const line = cart.lines[i];
                if (!line) return null;
                return (
                  <div key={line.key} className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-b border-border px-4 py-2.5">
                    <div className="text-pos-body font-medium text-ink">{line.name}</div>
                    <div className="self-center text-pos-body font-medium">
                      <MoneyText amount={lineTotal.totalAmount} currency={store.currency} />
                    </div>
                    <div className="col-span-full flex items-center gap-2 text-body-sm text-ink-muted">
                      <span className="inline-flex items-center overflow-hidden rounded border border-border">
                        <button
                          aria-label={`Decrease ${line.name}`}
                          className="h-10 w-11 bg-bg text-xl text-ink"
                          onClick={() => cart.setQty(line.key, line.qty - 1)}
                        >
                          −
                        </button>
                        <span className="w-10 text-center text-body font-semibold text-ink">{line.qty}</span>
                        <button
                          aria-label={`Increase ${line.name}`}
                          className="h-10 w-11 bg-bg text-xl text-ink"
                          onClick={() => cart.setQty(line.key, line.qty + 1)}
                        >
                          ＋
                        </button>
                      </span>
                      <span className="font-money">@ <MoneyText amount={line.unitPriceAmount} currency={store.currency} /></span>
                      {lineTotal.lineDiscountAmount > 0 && (
                        <span className="text-success">− <MoneyText amount={lineTotal.lineDiscountAmount} currency={store.currency} /></span>
                      )}
                      <button
                        aria-label={`Remove ${line.name}`}
                        className="ml-auto text-ink-muted hover:text-danger"
                        onClick={() => cart.removeLine(line.key)}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2 border-t border-border px-4 pt-2">
            <button onClick={onOpenDiscount} className="flex-1 min-h-touch-pos rounded border border-border text-body text-ink disabled:opacity-40" disabled={cart.lines.length === 0}>
              Discount
            </button>
            <button onClick={onOpenCustomSale} className="flex-1 min-h-touch-pos rounded border border-border text-body text-ink">
              Custom sale
            </button>
          </div>

          <div className="px-4 pb-2 pt-2 text-body">
            <TotalRow label={`Subtotal (${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'})`} amount={cart.totals.subtotalAmount} currency={store.currency} />
            <TotalRow label="Discount" amount={cart.totals.discountAmount} currency={store.currency} />
            <TotalRow
              label={store.priceMode === 'tax_inclusive' ? 'VAT 12% (included)' : 'VAT 12%'}
              amount={cart.totals.taxAmount}
              currency={store.currency}
            />
            <div className="flex items-center justify-between pt-2 text-h3 font-semibold text-ink">
              <span>Total</span>
              <MoneyText amount={cart.totals.totalAmount} currency={store.currency} />
            </div>
          </div>

          <button
            onClick={onCharge}
            disabled={cart.lines.length === 0}
            className="mx-4 mb-4 flex h-16 items-center justify-between rounded-card bg-primary px-5 text-h2 font-semibold text-white hover:bg-primary-hover disabled:opacity-40"
          >
            <span>Charge</span>
            <MoneyText amount={cart.totals.totalAmount} currency={store.currency} className="text-white" />
          </button>
        </aside>
      </div>
    </div>
  );
}

function SyncPill({ online, queued }: { online: boolean; queued: number }) {
  if (online) {
    return (
      <span className="flex items-center gap-2 rounded-full bg-[#E7F3EA] px-3.5 py-2 text-body-sm font-medium text-success">
        <span className="h-2.5 w-2.5 rounded-full bg-success" />
        Synced · just now
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 rounded-full bg-[#FDF3E3] px-3.5 py-2 text-body-sm font-medium text-[#9A6200]">
      <span className="h-2.5 w-2.5 rounded-full bg-warning" />
      Offline{queued > 0 ? ` · ${queued} queued` : ''}
    </span>
  );
}

function CategoryChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        'min-h-touch-pos rounded-full border px-4 text-pos-body ' +
        (active ? 'border-primary bg-primary font-medium text-white' : 'border-border bg-surface text-ink')
      }
    >
      {label}
    </button>
  );
}

function ProductTile({
  variant,
  currency,
  onClick,
}: {
  variant: SellableVariant;
  currency: string;
  onClick: () => void;
}) {
  const low = variant.trackStock && variant.onHand > 0 && variant.onHand <= 5;
  return (
    <button
      onClick={onClick}
      className={
        'flex flex-col justify-between rounded-card border bg-surface p-3 text-left shadow-card ' +
        (low ? 'border-warning' : 'border-border')
      }
    >
      <span className="text-pos-body font-medium leading-tight text-ink">{variant.productName}</span>
      <span className="flex items-center justify-between">
        <MoneyText amount={variant.priceAmount} currency={currency} className="text-body text-ink-muted" />
        {low && <span className="rounded bg-[#FDF3E3] px-1.5 text-caption text-[#9A6200]">{variant.onHand} left</span>}
      </span>
    </button>
  );
}

function TotalRow({ label, amount, currency }: { label: string; amount: number; currency: string }) {
  return (
    <div className="flex justify-between py-0.5 text-ink-muted">
      <span>{label}</span>
      <MoneyText amount={amount} currency={currency} />
    </div>
  );
}

function EmptyCart() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-ink-muted">
      <svg className="h-11 w-11 stroke-current" viewBox="0 0 24 24" fill="none" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
      <p className="text-pos-body font-medium text-ink">Cart is empty</p>
      <p className="max-w-[240px] text-body-sm">
        Scan a barcode, search, or tap a product to start a sale. Offline mode changes nothing here.
      </p>
    </div>
  );
}
