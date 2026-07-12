import type { LocalSaleInput, StoreMeta } from '@retailos/sync';
import { MoneyText } from '@retailos/ui';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

/**
 * POS-05 Receipt/Done. Change due is the hero the cashier reads aloud. The
 * receipt renders from the local sale fact (works fully offline); the QR points
 * at the admin public receipt route /r/<order-ulid>. Browser pos-web prints via
 * the native dialog (ESC/POS thermal printing is the Electron path). An auto-
 * return timer keeps the line moving; any tap cancels it.
 */

const RECEIPT_BASE_URL =
  (import.meta.env.VITE_RECEIPT_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3000';
const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ??
  'http://localhost:3001/api/v1';
const AUTO_RETURN_SECONDS = 12;

interface ReceiptScreenProps {
  store: StoreMeta;
  staffName: string;
  sale: LocalSaleInput;
  change: number;
  onNewSale: () => void;
}

type EmailState = 'idle' | 'sending' | 'sent' | 'queued';

export function ReceiptScreen({ store, staffName, sale, change, onNewSale }: ReceiptScreenProps) {
  const receiptUrl = `${RECEIPT_BASE_URL}/r/${sale.id}`;
  const [qr, setQr] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(AUTO_RETURN_SECONDS);
  const [paused, setPaused] = useState(false);
  const [email, setEmail] = useState('');
  const [emailState, setEmailState] = useState<EmailState>('idle');
  const onNewSaleRef = useRef(onNewSale);
  onNewSaleRef.current = onNewSale;

  useEffect(() => {
    void QRCode.toDataURL(receiptUrl, { margin: 1, width: 160 }).then(setQr).catch(() => setQr(null));
  }, [receiptUrl]);

  useEffect(() => {
    if (paused) return;
    if (seconds <= 0) {
      onNewSaleRef.current();
      return;
    }
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds, paused]);

  const cash = sale.payments.find((p) => p.tender === 'cash');
  const vat = sale.totals.tax;
  const vatable = sale.totals.total - vat;
  const created = new Date(sale.clientCreatedAt);

  const sendEmail = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    setEmailState('sending');
    fetch(`${API_BASE_URL}/public/receipts/${sale.id}/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then((res) => setEmailState(res.ok ? 'sent' : 'queued'))
      .catch(() => setEmailState('queued')); // offline / not yet synced — send later
  };

  return (
    <div className="flex h-screen bg-bg" onClick={() => setPaused(true)}>
      {/* Done column */}
      <div className="no-print flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <span className="flex items-center gap-2 rounded-full bg-[#E7F3EA] px-4 py-2 text-body font-medium text-success">
          ✓ Paid · {cash ? 'Cash' : 'Card'}{' '}
          <MoneyText amount={cash ? cash.amount + cash.change : sale.totals.total} currency={store.currency} />
        </span>
        <p className="text-body-sm text-ink-muted">
          Order {sale.number} · {created.toLocaleString('en-PH')} · {staffName}
        </p>
        {change > 0 && (
          <>
            <p className="text-pos-body text-ink-muted">Change due</p>
            <p className="text-pos-total font-semibold text-ink">
              <MoneyText amount={change} currency={store.currency} />
            </p>
          </>
        )}

        <div className="mt-2 grid w-full max-w-md grid-cols-2 gap-3">
          <button onClick={() => window.print()} className="min-h-touch-pos rounded-card border border-border bg-surface text-body text-ink">
            Print again
          </button>
          <a href={receiptUrl} target="_blank" rel="noreferrer" className="flex min-h-touch-pos items-center justify-center rounded-card border border-border bg-surface text-body text-ink">
            Open QR receipt
          </a>
        </div>

        <div className="flex w-full max-w-md items-center gap-2">
          <input
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailState('idle'); }}
            placeholder="Email receipt to…"
            inputMode="email"
            className="min-h-touch-pos flex-1 rounded border border-border bg-surface px-3 text-body text-ink outline-none focus:border-primary"
          />
          <button onClick={sendEmail} disabled={emailState === 'sending'} className="min-h-touch-pos rounded border border-border bg-surface px-4 text-body text-ink disabled:opacity-40">
            {emailState === 'sent' ? 'Sent ✓' : emailState === 'queued' ? 'Queued' : emailState === 'sending' ? 'Sending…' : 'Email'}
          </button>
        </div>

        <button onClick={onNewSale} className="mt-2 min-h-touch-pos w-full max-w-md rounded-card bg-primary px-8 py-3 text-pos-body font-semibold text-white hover:bg-primary-hover">
          New sale
        </button>
        <p className="text-caption text-ink-muted">
          {paused ? 'Auto-return paused — tap New sale when ready' : `Returning to Sell in ${seconds}s — tap anywhere to stay`}
        </p>
      </div>

      {/* Receipt preview (the only thing that prints) */}
      <aside className="print-receipt flex w-[340px] flex-none flex-col gap-1 border-l border-border bg-surface p-6 font-money text-body-sm text-ink">
        <p className="text-center text-body font-semibold uppercase tracking-wide">{store.name}</p>
        <p className="text-center text-caption text-ink-muted">Poblacion branch · Register 2</p>
        <Rule />
        <Row left={sale.number} right={created.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })} />
        <Row left="Cashier" right={staffName} />
        <Rule />
        {sale.lines.map((line) => (
          <Row key={line.id} left={`${line.name} ×${line.qty}`} right={<MoneyText amount={line.totalAmount} currency={store.currency} />} />
        ))}
        <Rule />
        <Row bold left="TOTAL" right={<MoneyText amount={sale.totals.total} currency={store.currency} />} />
        {sale.payments.map((p) => (
          <Row key={p.id} left={p.tender === 'cash' ? 'Cash' : 'Card'} right={<MoneyText amount={p.amount + p.change} currency={store.currency} />} />
        ))}
        {change > 0 && <Row left="Change" right={<MoneyText amount={change} currency={store.currency} />} />}
        <Rule />
        <Row left="VATable sales" right={<MoneyText amount={vatable} currency={store.currency} />} />
        <Row left="VAT 12%" right={<MoneyText amount={vat} currency={store.currency} />} />
        <div className="mt-3 flex flex-col items-center gap-1">
          {qr && <img src={qr} alt="Scan for e-receipt" width={128} height={128} />}
          <p className="text-center text-caption text-ink-muted">Scan for your e-receipt</p>
          <p className="text-center text-caption text-ink-muted">Salamat po!</p>
        </div>
      </aside>
    </div>
  );
}

function Row({ left, right, bold }: { left: React.ReactNode; right: React.ReactNode; bold?: boolean }) {
  return (
    <div className={'flex justify-between gap-2 ' + (bold ? 'font-semibold' : '')}>
      <span className="truncate">{left}</span>
      <span>{right}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-1 border-t border-dashed border-border" />;
}
