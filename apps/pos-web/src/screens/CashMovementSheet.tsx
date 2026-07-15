import { recordCashMovement, type CashMovementKind, type SqlDriver } from '@retailos/sync';
import { Button, Modal, MoneyText, NumberPad } from '@retailos/ui';
import { useState } from 'react';
import { ulid } from 'ulid';
import { PinPad } from '../components/PinPad';
import { isOwner, verifyOwnerPin } from '../lib/escalation';

/**
 * Paid in / paid out / no-sale drawer opens (FR-6.1). Cashiers may record paid
 * in/out with a reason. Opening the drawer with no sale needs an Owner PIN
 * (FR-5.2) — the approval is recorded on the movement (approved-by). Works offline.
 */

interface CashMovementSheetProps {
  driver: SqlDriver;
  currency: string;
  shiftId: string;
  staff: { id: string; roleId: string };
  onDone: () => void;
  onClose: () => void;
}

type Mode = 'paid_in' | 'paid_out' | 'no_sale';

const MODES: { value: Mode; label: string; sub: string }[] = [
  { value: 'paid_in', label: 'Paid in', sub: 'cash added' },
  { value: 'paid_out', label: 'Paid out', sub: 'cash removed' },
  { value: 'no_sale', label: 'No sale', sub: 'open drawer' },
];

export function CashMovementSheet({ driver, currency, shiftId, staff, onDone, onClose }: CashMovementSheetProps) {
  const [mode, setMode] = useState<Mode>('paid_out');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isNoSale = mode === 'no_sale';
  const needsOwner = isNoSale && !isOwner(staff.roleId);
  const canSubmit = isNoSale ? true : amount > 0 && reason.trim().length > 0;

  const commit = (kind: CashMovementKind, approvedBy: string | null) => {
    recordCashMovement(driver, {
      id: ulid(),
      shiftId,
      kind,
      amount: kind === 'no_sale' ? 0 : amount,
      reason: kind === 'no_sale' ? reason.trim() || 'No sale' : reason.trim(),
      staffId: staff.id,
      approvedByStaffId: approvedBy,
      clientCreatedAt: new Date().toISOString(),
    });
    onDone();
  };

  const submit = () => {
    if (!canSubmit) return;
    if (needsOwner) {
      setError(null);
      setBusy(true);
      void verifyOwnerPin(driver, pin).then((approverId) => {
        setBusy(false);
        if (approverId) commit('no_sale', approverId);
        else {
          setError('That PIN did not match an Owner. Try again.');
          setPin('');
        }
      });
      return;
    }
    commit(mode, null);
  };

  return (
    <Modal
      open
      title="Cash drawer"
      onClose={onClose}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit || busy || (needsOwner && pin.length < 4)}>
            {submitLabel(mode, needsOwner, amount, currency)}
          </Button>
        </>
      }
    >
      <div className="mb-4 inline-flex overflow-hidden rounded border border-border">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              setMode(m.value);
              setError(null);
              setPin('');
            }}
            className={
              'flex flex-col px-5 py-2 text-body ' +
              (mode === m.value ? 'bg-primary text-white' : 'bg-surface text-ink')
            }
          >
            {m.label}
            <span className={'text-caption ' + (mode === m.value ? 'text-white/80' : 'text-ink-muted')}>
              {m.sub}
            </span>
          </button>
        ))}
      </div>

      {needsOwner ? (
        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div>
            <div className="mb-3 rounded border border-warning/40 bg-[#FDF3E3] p-3 text-body-sm text-ink">
              Opening the drawer without a sale needs an Owner. The approval is recorded (approved-by).
              Works offline.
            </div>
            <label className="text-body-sm text-ink-muted">Reason (optional)</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Making change for a customer"
              className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
            />
            <div className="mt-4 mb-2 flex gap-2" aria-label="Owner PIN">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={'h-3 w-3 rounded-full ' + (i < pin.length ? 'bg-primary' : 'bg-border')} />
              ))}
            </div>
            <p className="text-caption text-ink-muted">Owner PIN</p>
            {error && <p className="mt-1 text-caption text-danger">{error}</p>}
          </div>
          <PinPad
            onDigit={(d) => setPin((p) => (p.length < 6 ? p + d : p))}
            onBackspace={() => setPin((p) => p.slice(0, -1))}
            onClear={() => setPin('')}
            disabled={busy}
          />
        </div>
      ) : isNoSale ? (
        <div>
          <label className="text-body-sm text-ink-muted">Reason (optional)</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Making change for a customer"
            className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
          />
          <p className="mt-3 text-body-sm text-ink-muted">No cash is counted — this only records the drawer opening.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_auto] gap-6">
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-body-sm text-ink-muted">Amount</label>
              <div className="mt-1 rounded border border-border px-4 py-3 text-right font-money text-h2 text-ink">
                <MoneyText amount={amount} currency={currency} />
              </div>
            </div>
            <div>
              <label className="text-body-sm text-ink-muted">Reason (required)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={mode === 'paid_out' ? 'e.g. LPG supplier COD' : 'e.g. Owner cash top-up'}
                className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 text-body text-ink outline-none focus:border-primary"
              />
            </div>
          </div>
          <NumberPad value={amount} onChange={setAmount} className="w-56" />
        </div>
      )}
    </Modal>
  );
}

function submitLabel(mode: Mode, needsOwner: boolean, amount: number, currency: string) {
  if (mode === 'no_sale') return needsOwner ? 'Approve & open drawer' : 'Open drawer';
  const verb = mode === 'paid_in' ? 'Paid in' : 'Paid out';
  return amount > 0 ? `${verb} · ${(amount / 100).toLocaleString('en-PH', { style: 'currency', currency })}` : verb;
}
