import { applyBasisPoints, type Discount } from '@retailos/domain';
import { Button, Modal, MoneyText, NumberPad } from '@retailos/ui';
import type { SqlDriver } from '@retailos/sync';
import { useMemo, useState } from 'react';
import { PinPad } from '../components/PinPad';
import { CASHIER_DISCOUNT_LIMIT_BP, discountNeedsEscalation, verifyOwnerPin } from '../lib/escalation';

/**
 * POS-14 discount sheet. Percent or fixed, reason required, live old→new
 * preview. A discount over the Cashier's 10% ceiling (FR-5.2) reveals inline
 * Owner-PIN escalation in the same sheet — the request is preserved so the
 * Owner approves exactly what was asked (dual attribution: sold-by + approved-by).
 */

interface DiscountSheetProps {
  driver: SqlDriver;
  currency: string;
  roleId: string;
  target: { label: string; total: number };
  existing: Discount | null;
  onApply: (discount: Discount, approvedBy: string | null, reason: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

const QUICK_PERCENTS = [5, 10, 15, 20];

export function DiscountSheet({
  driver,
  currency,
  roleId,
  target,
  existing,
  onApply,
  onRemove,
  onClose,
}: DiscountSheetProps) {
  const [type, setType] = useState<'percent' | 'fixed'>(existing?.type ?? 'percent');
  const [percent, setPercent] = useState(
    existing?.type === 'percent' ? Math.round(existing.value / 100) : 10,
  );
  const [fixed, setFixed] = useState(existing?.type === 'fixed' ? existing.value : 0);
  const [reason, setReason] = useState('');
  const [escalating, setEscalating] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const discount: Discount = useMemo(
    () => (type === 'percent' ? { type: 'percent', value: percent * 100 } : { type: 'fixed', value: fixed }),
    [type, percent, fixed],
  );

  const discountAmount =
    type === 'percent' ? applyBasisPoints(target.total, percent * 100) : Math.min(fixed, target.total);
  const newTotal = target.total - discountAmount;
  const overLimit = discountNeedsEscalation(roleId, discountAmount, target.total);
  const canSubmit = reason.trim().length > 0 && discountAmount > 0;
  const limitPct = CASHIER_DISCOUNT_LIMIT_BP / 100;

  const submit = () => {
    if (!canSubmit) return;
    if (overLimit) {
      setEscalating(true);
      return;
    }
    onApply(discount, null, reason.trim());
  };

  const approve = () => {
    setError(null);
    setChecking(true);
    void verifyOwnerPin(driver, pin).then((approverId) => {
      setChecking(false);
      if (approverId) {
        onApply(discount, approverId, reason.trim());
      } else {
        setError('That PIN did not match an Owner. Try again.');
        setPin('');
      }
    });
  };

  return (
    <Modal open title="Discount" onClose={onClose} className="max-w-2xl" footer={
      escalating ? (
        <>
          <Button variant="ghost" onClick={() => { setEscalating(false); setPin(''); setError(null); }}>
            Back — use {limitPct}% instead
          </Button>
          <Button onClick={approve} disabled={pin.length < 4 || checking}>
            Approve {type === 'percent' ? `${percent}%` : ''} discount · <MoneyText amount={-discountAmount} currency={currency} className="text-white" />
          </Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {existing && <Button variant="danger" onClick={onRemove}>Remove discount</Button>}
          <Button onClick={submit} disabled={!canSubmit}>
            Apply discount · <MoneyText amount={-discountAmount} currency={currency} className="text-white" />
          </Button>
        </>
      )
    }>
      <div className="mb-3 flex items-center justify-between rounded border border-border bg-bg px-4 py-3">
        <span className="text-pos-body font-medium text-ink">{target.label}</span>
        <span className="text-body-sm text-ink-muted">
          Total <MoneyText amount={target.total} currency={currency} />
        </span>
      </div>

      {escalating ? (
        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div>
            <div className="mb-3 flex gap-3 rounded border border-warning/40 bg-[#FDF3E3] p-3 text-body-sm">
              <span className="text-ink">
                {percent}% is over the {limitPct}% Cashier limit — an Owner can approve it. The approval is
                recorded on the order (approved-by, amount, reason). Works offline.
              </span>
            </div>
            <div className="rounded border-t-0 text-body-sm">
              <PreviewRow label={`Requested discount`} value={<MoneyText amount={-discountAmount} currency={currency} />} />
              <PreviewRow label="Reason" value={<span className="text-ink">{reason}</span>} />
              <PreviewRow strong label="New total" value={<MoneyText amount={newTotal} currency={currency} />} />
            </div>
            <div className="mt-4">
              <div className="mb-2 flex gap-2" aria-label="Owner PIN">
                {[0, 1, 2, 3, 4, 5].slice(0, Math.max(4, pin.length)).map((i) => (
                  <span key={i} className={'h-3 w-3 rounded-full ' + (i < pin.length ? 'bg-primary' : 'bg-border')} />
                ))}
              </div>
              <p className="text-caption text-ink-muted">Owner PIN{error ? '' : ''}</p>
              {error && <p className="mt-1 text-caption text-danger">{error}</p>}
            </div>
          </div>
          <PinPad
            onDigit={(d) => setPin((p) => (p.length < 6 ? p + d : p))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
            onClear={() => setPin('')}
            disabled={checking}
          />
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-body-sm text-ink-muted">Type</label>
              <div className="mt-1 inline-flex overflow-hidden rounded border border-border">
                <TypeOpt active={type === 'percent'} onClick={() => setType('percent')}>Percent %</TypeOpt>
                <TypeOpt active={type === 'fixed'} onClick={() => setType('fixed')}>Fixed ₱</TypeOpt>
              </div>
            </div>
            <div>
              <label className="text-body-sm text-ink-muted">
                Amount{roleId !== 'owner' ? ` — your limit as Cashier is ${limitPct}%` : ''}
              </label>
              <div className="mt-1 rounded border border-border px-4 py-3 text-right font-money text-h2 text-ink">
                {type === 'percent' ? `${percent}%` : <MoneyText amount={fixed} currency={currency} />}
              </div>
            </div>
            {type === 'percent' && (
              <div className="flex gap-2">
                {QUICK_PERCENTS.map((p) => {
                  const over = discountNeedsEscalation(roleId, applyBasisPoints(target.total, p * 100), target.total);
                  return (
                    <button
                      key={p}
                      onClick={() => setPercent(p)}
                      className={
                        'min-h-touch-pos flex-1 rounded border text-body ' +
                        (percent === p ? 'border-primary bg-primary text-white ' : 'border-border text-ink ') +
                        (over ? 'opacity-60' : '')
                      }
                    >
                      {p}%{over ? ' 🔒' : ''}
                    </button>
                  );
                })}
              </div>
            )}
            <div>
              <label className="text-body-sm text-ink-muted">Reason (required)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Slightly damaged packaging"
                className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
              />
            </div>
            <div className="rounded border-t border-border pt-2 text-body-sm">
              <PreviewRow label="Total" value={<MoneyText amount={target.total} currency={currency} className="line-through" />} />
              <PreviewRow label={type === 'percent' ? `Discount ${percent}%` : 'Discount'} value={<MoneyText amount={-discountAmount} currency={currency} />} />
              <PreviewRow strong label="New total" value={<MoneyText amount={newTotal} currency={currency} />} />
            </div>
          </div>
          {type === 'percent' ? (
            <NumberPad value={percent} onChange={setPercent} max={100} doubleZero={false} className="w-56" />
          ) : (
            <NumberPad value={fixed} onChange={setFixed} className="w-56" />
          )}
        </div>
      )}
    </Modal>
  );
}

function TypeOpt({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={'px-4 py-2 text-body ' + (active ? 'bg-primary text-white' : 'bg-surface text-ink')}>
      {children}
    </button>
  );
}

function PreviewRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={'flex justify-between py-1 ' + (strong ? 'font-semibold text-ink' : 'text-ink-muted')}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
