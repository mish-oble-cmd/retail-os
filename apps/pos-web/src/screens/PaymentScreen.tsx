import { formatSaleNumber } from '@retailos/domain';
import { recordSale, type LocalSaleInput, type LocalSalePayment, type SqlDriver, type StoreMeta } from '@retailos/sync';
import { Button, MoneyText, NumberPad } from '@retailos/ui';
import { useMemo, useState } from 'react';
import type { UseCart } from '../lib/cart';
import { DEMO_LOCATION_ID } from '../lib/device';
import { buildSaleInput } from '../lib/sale';

/**
 * POS-04 Payment. Cash (NumberPad + quick-amount chips + change) and manual
 * card (reference + last 4 only — never a full PAN). Split tenders accumulate
 * until the amount due is covered; completing writes the sale to the device
 * outbox (recordSale) with its stock movements, then advances to the receipt.
 */

interface PaymentScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  staff: { id: string; name: string };
  cart: UseCart;
  onBack: () => void;
  onComplete: (result: { sale: LocalSaleInput; change: number }) => void;
}

type Tender = 'cash' | 'card_manual';

const roundUp = (n: number, step: number) => Math.ceil(n / step) * step;

function cashChips(remaining: number): number[] {
  const chips = new Set<number>([remaining]);
  for (const step of [10_000, 50_000, 100_000]) chips.add(roundUp(remaining, step));
  return [...chips].filter((c) => c >= remaining && c > 0).sort((a, b) => a - b).slice(0, 4);
}

export function PaymentScreen({ driver, store, staff, cart, onBack, onComplete }: PaymentScreenProps) {
  const total = cart.totals.totalAmount;
  const [payments, setPayments] = useState<LocalSalePayment[]>([]);
  const [tender, setTender] = useState<Tender>('cash');
  const [entry, setEntry] = useState(0);
  const [cardRef, setCardRef] = useState('');
  const [cardLast4, setCardLast4] = useState('');
  const [busy, setBusy] = useState(false);

  const applied = payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = total - applied;
  const changeSoFar = payments.reduce((sum, p) => sum + p.change, 0);
  const last4Valid = /^\d{4}$/.test(cardLast4);

  const chips = useMemo(() => cashChips(remaining), [remaining]);

  const resetEntry = () => {
    setEntry(0);
    setCardRef('');
    setCardLast4('');
  };

  const makePayment = (): LocalSalePayment | null => {
    if (entry <= 0) return null;
    if (tender === 'cash') {
      const amount = Math.min(entry, remaining);
      return { id: cryptoId(), tender: 'cash', amount, change: Math.max(0, entry - remaining) };
    }
    if (!last4Valid) return null;
    return {
      id: cryptoId(),
      tender: 'card_manual',
      amount: Math.min(entry, remaining),
      change: 0,
      cardRef: cardRef.trim() || null,
      cardLast4,
    };
  };

  const addPayment = () => {
    const payment = makePayment();
    if (!payment) return;
    setPayments((prev) => [...prev, payment]);
    resetEntry();
  };

  const removePayment = (id: string) => setPayments((prev) => prev.filter((p) => p.id !== id));

  // Does the current entry (or already-applied payments) cover the sale?
  const entryCovers =
    remaining > 0 && entry >= remaining && (tender === 'cash' || last4Valid);
  const canComplete = remaining <= 0 || entryCovers;
  const canPartial = remaining > 0 && entry > 0 && entry < remaining && (tender === 'cash' || last4Valid);

  const finalize = () => {
    setBusy(true);
    // Fold a covering current entry into the payment list first.
    let finalPayments = payments;
    if (remaining > 0) {
      const payment = makePayment();
      if (!payment) {
        setBusy(false);
        return;
      }
      finalPayments = [...payments, payment];
    }
    const seq =
      driver.get<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) + 1 AS n FROM orders`)?.n ?? 1;
    const sale = buildSaleInput({
      lines: cart.lines,
      totals: cart.totals,
      currency: store.currency,
      staffId: staff.id,
      locationId: DEMO_LOCATION_ID,
      seq,
      number: formatSaleNumber(seq, { prefix: 'R2' }),
      payments: finalPayments,
    });
    recordSale(driver, sale);
    const change = finalPayments.reduce((sum, p) => sum + p.change, 0);
    onComplete({ sale, change });
  };

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <button onClick={onBack} className="flex items-center gap-1 text-body text-ink-muted hover:text-ink">
          ‹ Back to sale
        </button>
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">Payment</p>
          <p className="text-caption text-ink-muted">{cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}</p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 gap-6 p-6">
        {/* Left: due, tenders, split, change */}
        <div className="flex flex-1 flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-5">
            <p className="text-body-sm text-ink-muted">Amount due</p>
            <p className="text-pos-total font-semibold text-ink">
              <MoneyText amount={Math.max(0, remaining)} currency={store.currency} />
            </p>
            <p className="text-caption text-ink-muted">
              Total <MoneyText amount={total} currency={store.currency} /> · VAT included{' '}
              <MoneyText amount={cart.totals.taxAmount} currency={store.currency} />
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <TenderButton active={tender === 'cash'} onClick={() => setTender('cash')} label="Cash" />
            <TenderButton active={tender === 'card_manual'} onClick={() => setTender('card_manual')} label="Card" sub="manual ref" />
          </div>

          {payments.length > 0 && (
            <div className="rounded-card border border-border bg-surface">
              <p className="border-b border-border bg-bg px-4 py-2 text-body-sm text-ink-muted">Payments on this sale</p>
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                  <span className="font-medium text-ink">{p.tender === 'cash' ? 'Cash' : 'Card (manual)'}</span>
                  <span className="text-body-sm text-ink-muted">
                    {p.tender === 'cash'
                      ? p.change > 0 ? `tendered ${fmt(p.amount + p.change, store.currency)}` : 'exact'
                      : `ref ${p.cardRef ?? '—'} · ****${p.cardLast4 ?? ''}`}
                  </span>
                  <span className="ml-auto font-medium"><MoneyText amount={p.amount} currency={store.currency} /></span>
                  <button onClick={() => removePayment(p.id)} aria-label="Remove payment" className="text-ink-muted hover:text-danger">✕</button>
                </div>
              ))}
            </div>
          )}

          {changeSoFar > 0 && (
            <div className="mt-auto flex items-center justify-between rounded-card border border-[#BFE0C8] bg-[#E7F3EA] px-5 py-4">
              <span className="text-pos-body font-medium text-success">Change due</span>
              <span className="text-pos-total font-semibold text-success"><MoneyText amount={changeSoFar} currency={store.currency} /></span>
            </div>
          )}
        </div>

        {/* Right: entry + pad + complete */}
        <div className="flex w-[340px] flex-none flex-col gap-3">
          <p className="text-body-sm text-ink-muted">{tender === 'cash' ? 'Cash received' : 'Card amount'}</p>
          <div className="rounded border border-border px-4 py-3 text-right font-money text-pos-total text-ink">
            <MoneyText amount={entry} currency={store.currency} />
          </div>

          {tender === 'cash' ? (
            <div className="grid grid-cols-4 gap-2">
              {chips.map((c) => (
                <button key={c} onClick={() => setEntry(c)} className="min-h-touch-pos rounded border border-border text-body-sm text-ink">
                  {fmt(c, store.currency)}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <input
                value={cardRef}
                onChange={(e) => setCardRef(e.target.value)}
                placeholder="Terminal slip reference"
                className="rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
              />
              <input
                value={cardLast4}
                onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Last 4 digits"
                inputMode="numeric"
                className={'rounded border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary ' + (cardLast4 && !last4Valid ? 'border-danger' : 'border-border')}
              />
              {cardLast4.length > 0 && !last4Valid && (
                <p className="text-caption text-danger">Enter the last 4 digits only — full card numbers are never stored.</p>
              )}
            </div>
          )}

          <NumberPad value={entry} onChange={setEntry} />

          {canPartial && !entryCovers && (
            <Button variant="secondary" onClick={addPayment}>
              Add payment · <MoneyText amount={entry} currency={store.currency} />
            </Button>
          )}
          <Button onClick={finalize} disabled={!canComplete || busy}>
            {changeSoFarLabel(canComplete, tender, entry, remaining, changeSoFar, store.currency)}
          </Button>
        </div>
      </div>
    </div>
  );
}

function changeSoFarLabel(canComplete: boolean, tender: Tender, entry: number, remaining: number, changeSoFar: number, currency: string) {
  if (!canComplete) return 'Enter amount';
  const change = changeSoFar + (tender === 'cash' && remaining > 0 ? Math.max(0, entry - remaining) : 0);
  return change > 0 ? `Complete sale — change ${fmt(change, currency)}` : 'Complete sale';
}

function TenderButton({ active, onClick, label, sub }: { active: boolean; onClick: () => void; label: string; sub?: string }) {
  return (
    <button
      onClick={onClick}
      className={'flex h-16 flex-col items-center justify-center rounded-card border text-pos-body ' + (active ? 'border-2 border-primary bg-primary/5 text-ink' : 'border-border bg-surface text-ink')}
    >
      {label}
      {sub && <span className="text-caption text-ink-muted">{sub}</span>}
    </button>
  );
}

const fmt = (amount: number, currency: string) =>
  (amount / 100).toLocaleString('en-PH', { style: 'currency', currency });

const cryptoId = () => globalThis.crypto.randomUUID();
