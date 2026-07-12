import { calculateRefund, type RefundSelection, type RefundableLine } from '@retailos/domain';
import {
  getOrderDetail,
  recordRefund,
  type LocalRefundInput,
  type SqlDriver,
  type StoreMeta,
} from '@retailos/sync';
import { Button, MoneyText } from '@retailos/ui';
import { useMemo, useState } from 'react';
import { ulid } from 'ulid';
import { PinPad } from '../components/PinPad';
import { DEMO_LOCATION_ID } from '../lib/device';
import { isOwner, verifyOwnerPin } from '../lib/escalation';

/**
 * POS-08 refund. Line-level (FR-1.8): stepper shows "N of M" remaining
 * refundable, restock is per-line and defaults ON, fully-refunded lines are
 * disabled (over-refund killed at the UI; the ledger still enforces it). A
 * refund needs Owner approval at the register (FR-5.2) — an Owner session
 * proceeds directly, a Cashier is gated by an inline Owner-PIN check. The whole
 * flow is offline: the refund becomes an outbox fact like a sale.
 */

interface RefundScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  orderId: string;
  staff: { id: string; roleId: string };
  onBack: () => void;
  onDone: () => void;
}

type Tender = 'cash' | 'card_manual';

export function RefundScreen({ driver, store, orderId, staff, onBack, onDone }: RefundScreenProps) {
  const detail = useMemo(() => getOrderDetail(driver, orderId), [driver, orderId]);
  const [selections, setSelections] = useState<Record<string, { qty: number; restock: boolean }>>({});
  const [tender, setTender] = useState<Tender>('cash');
  const [reason, setReason] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refundableLines: RefundableLine[] = useMemo(
    () =>
      (detail?.lines ?? []).map((l) => ({
        id: l.id,
        variantId: l.variantId,
        name: l.name,
        qty: l.qty,
        refundedQty: l.refundedQty,
        unitPriceAmount: l.unitPriceAmount,
        totalAmount: l.totalAmount,
        taxLines: l.taxLines,
      })),
    [detail],
  );

  const activeSelections: RefundSelection[] = Object.entries(selections)
    .filter(([, s]) => s.qty > 0)
    .map(([lineId, s]) => ({ lineId, qty: s.qty, restock: s.restock }));

  const preview = useMemo(() => {
    if (activeSelections.length === 0) return null;
    try {
      return calculateRefund({ currency: store.currency, lines: refundableLines, selections: activeSelections });
    } catch {
      return null;
    }
  }, [refundableLines, activeSelections, store.currency]);

  if (!detail) return <div className="flex h-screen items-center justify-center bg-bg text-ink-muted">Order not found.</div>;

  const setQty = (line: RefundableLine, qty: number) => {
    const remaining = line.qty - (line.refundedQty ?? 0);
    const clamped = Math.max(0, Math.min(qty, remaining));
    setSelections((prev) => ({ ...prev, [line.id]: { qty: clamped, restock: prev[line.id]?.restock ?? true } }));
  };
  const toggleRestock = (lineId: string) =>
    setSelections((prev) => ({ ...prev, [lineId]: { qty: prev[lineId]?.qty ?? 0, restock: !(prev[lineId]?.restock ?? true) } }));

  const commit = (approvedBy: string | null) => {
    if (!preview) return;
    setBusy(true);
    const nextSeq = () => {
      const o = driver.get<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) AS n FROM orders`)?.n ?? 0;
      const r = driver.get<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) AS n FROM refunds`)?.n ?? 0;
      return Math.max(o, r) + 1;
    };
    const taxByRate = new Map<string, number>();
    for (const l of preview.lines) for (const t of l.taxLines) taxByRate.set(t.rateId, (taxByRate.get(t.rateId) ?? 0) + t.amount);

    const refund: LocalRefundInput = {
      id: ulid(),
      orderId,
      staffId: staff.id,
      approvedBy,
      currency: store.currency,
      totalAmount: preview.totalAmount,
      taxAmount: preview.taxAmount,
      taxLines: [...taxByRate].map(([rateId, amount]) => ({ rateId, amount })),
      tender,
      lines: preview.lines.map((l) => ({
        id: ulid(),
        orderLineId: l.lineId,
        variantId: l.variantId,
        qty: l.qty,
        amount: l.amount,
        restock: l.restock,
      })),
      movements: preview.restock.map((r) => ({
        id: ulid(),
        variantId: r.variantId,
        locationId: DEMO_LOCATION_ID,
        qtyDelta: r.qty,
        movementType: 'refund_restock' as const,
      })),
      clientCreatedAt: new Date().toISOString(),
      localSeq: nextSeq(),
    };
    recordRefund(driver, refund);
    onDone();
  };

  const submit = () => {
    if (!preview) return;
    if (isOwner(staff.roleId)) {
      commit(staff.id);
    } else {
      setEscalating(true);
    }
  };

  const approve = () => {
    setError(null);
    void verifyOwnerPin(driver, pin).then((ownerId) => {
      if (ownerId) commit(ownerId);
      else {
        setError('That PIN did not match an Owner.');
        setPin('');
      }
    });
  };

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <button onClick={onBack} className="flex items-center gap-1 text-body text-ink-muted hover:text-ink">
          ‹ Order {detail.number}
        </button>
        <p className="text-pos-body font-semibold text-ink">Refund</p>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 gap-6 p-6">
        <div className="flex-1 overflow-auto">
          <p className="mb-3 text-body-sm text-ink-muted">Tap lines to refund · set quantity · restock returns items to shelf stock.</p>
          <div className="flex flex-col gap-2">
            {refundableLines.map((line) => {
              const remaining = line.qty - (line.refundedQty ?? 0);
              const sel = selections[line.id];
              const selected = (sel?.qty ?? 0) > 0;
              const disabled = remaining <= 0;
              return (
                <div key={line.id} className={'rounded-card border bg-surface p-3 ' + (disabled ? 'opacity-55 ' : '') + (selected ? 'border-2 border-danger' : 'border-border')}>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={disabled}
                      onClick={() => setQty(line, selected ? 0 : 1)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="text-pos-body font-medium text-ink">{line.name}</p>
                      <p className="text-body-sm text-ink-muted">
                        Sold {line.qty} @ <MoneyText amount={line.unitPriceAmount} currency={store.currency} />
                        {disabled ? ' · fully refunded' : line.refundedQty ? ` · ${line.refundedQty} refunded` : ''}
                      </p>
                    </button>
                    <MoneyText amount={line.totalAmount} currency={store.currency} />
                  </div>
                  {selected && !disabled && (
                    <div className="mt-3 flex items-center gap-4">
                      <span className="inline-flex items-center overflow-hidden rounded border border-border">
                        <button className="h-9 w-10 bg-bg text-lg" onClick={() => setQty(line, (sel?.qty ?? 1) - 1)}>−</button>
                        <span className="w-16 text-center font-money text-body-sm">{sel?.qty} of {remaining}</span>
                        <button className="h-9 w-10 bg-bg text-lg" onClick={() => setQty(line, (sel?.qty ?? 1) + 1)}>＋</button>
                      </span>
                      <label className="flex items-center gap-2 text-body-sm text-ink">
                        <input type="checkbox" checked={sel?.restock ?? true} onChange={() => toggleRestock(line.id)} />
                        Restock — back to shelf
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex w-[320px] flex-none flex-col gap-3">
          {escalating ? (
            <div className="rounded-card border border-border bg-surface p-4">
              <p className="mb-1 text-pos-body font-medium text-ink">Owner approval</p>
              <p className="mb-3 text-body-sm text-ink-muted">A refund needs an Owner PIN. Works offline.</p>
              <div className="mb-3 flex gap-2">
                {[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => (
                  <span key={i} className={'h-3 w-3 rounded-full ' + (i < pin.length ? 'bg-danger' : 'bg-border')} />
                ))}
              </div>
              {error && <p className="mb-2 text-caption text-danger">{error}</p>}
              <PinPad onDigit={(d) => setPin((p) => (p.length < 6 ? p + d : p))} onBackspace={() => setPin((p) => p.slice(0, -1))} onClear={() => setPin('')} disabled={busy} />
              <div className="mt-3 flex gap-2">
                <Button variant="ghost" onClick={() => { setEscalating(false); setPin(''); }}>Back</Button>
                <Button variant="danger" onClick={approve} disabled={pin.length < 4 || busy}>Approve refund</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-body-sm text-ink-muted">Refund to</p>
              <div className="flex gap-2">
                <TenderBtn active={tender === 'cash'} onClick={() => setTender('cash')} label="Cash" />
                <TenderBtn active={tender === 'card_manual'} onClick={() => setTender('card_manual')} label="Original (card)" />
              </div>
              <label className="text-body-sm text-ink-muted">Reason — prints on the refund slip</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong item" className="rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary" />
              <div className="mt-auto rounded-card border border-border bg-surface px-4 py-3 text-body-sm">
                <div className="flex justify-between text-ink-muted"><span>VAT refunded</span><MoneyText amount={preview?.taxAmount ?? 0} currency={store.currency} /></div>
                <div className="flex justify-between text-h3 font-semibold text-ink"><span>Refund</span><MoneyText amount={preview?.totalAmount ?? 0} currency={store.currency} /></div>
              </div>
              <Button variant="danger" onClick={submit} disabled={!preview || busy}>
                Refund to {tender === 'cash' ? 'cash' : 'card'} · <MoneyText amount={preview?.totalAmount ?? 0} currency={store.currency} className="text-white" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TenderBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={'h-14 flex-1 rounded border text-body ' + (active ? 'border-2 border-danger font-semibold text-ink' : 'border-border text-ink')}>
      {label}
    </button>
  );
}
