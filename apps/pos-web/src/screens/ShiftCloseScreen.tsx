import { buildZReport, type ZSnapshot } from '@retailos/domain';
import { closeShift, getShiftZSource, type SqlDriver, type StoreMeta } from '@retailos/sync';
import { Button, MoneyText, NumberPad } from '@retailos/ui';
import { useMemo, useState } from 'react';
import { PinPad } from '../components/PinPad';
import { isOwner, verifyOwnerPin } from '../lib/escalation';

/**
 * POS-10 Shift close. The cashier counts the drawer *blind* — the expected
 * figure stays hidden until the count is submitted (FR-6.1). The over/short
 * reveal is Owner-gated: an Owner (closing, or approving with a PIN) sees the
 * number; a lone Cashier gets "recorded — see your manager". Closing writes the
 * shift.closed fact with the Z snapshot and prints the Z-report (FR-6.2).
 */

interface ShiftCloseScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  staff: { id: string; name: string; roleId: string };
  shift: { id: string; openingFloat: number; openedAtLabel?: string };
  registerName: string;
  onBack: () => void;
  onClosed: () => void;
}

export function ShiftCloseScreen({
  driver,
  store,
  staff,
  shift,
  registerName,
  onBack,
  onClosed,
}: ShiftCloseScreenProps) {
  const source = useMemo(() => getShiftZSource(driver, shift.id), [driver, shift.id]);
  const [counted, setCounted] = useState(0);
  const [phase, setPhase] = useState<'count' | 'review'>('count');
  const [revealed, setRevealed] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  const z: ZSnapshot | null = useMemo(
    () => (phase === 'review' ? buildZReport({ ...source, countedCash: counted }) : null),
    [phase, source, counted],
  );

  const canReveal = revealed || isOwner(staff.roleId);

  const approveReveal = () => {
    setChecking(true);
    setPinError(null);
    void verifyOwnerPin(driver, pin).then((approverId) => {
      setChecking(false);
      if (approverId) {
        setRevealed(true);
        setPinOpen(false);
        setPin('');
      } else {
        setPinError('That PIN did not match an Owner. Try again.');
        setPin('');
      }
    });
  };

  const close = () => {
    if (!z) return;
    setBusy(true);
    closeShift(driver, {
      id: shift.id,
      closedByStaffId: staff.id,
      closedAt: new Date().toISOString(),
      closingCounted: counted,
      closingExpected: z.expectedCash,
      overShort: z.overShort,
      z,
    });
    window.print();
    onClosed();
  };

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="no-print flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <button onClick={onBack} className="flex items-center gap-1 text-body text-ink-muted hover:text-ink">
          ‹ Back
        </button>
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">Close shift</p>
          <p className="text-caption text-ink-muted">
            {registerName} · {store.name}
            {shift.openedAtLabel ? ` · opened ${shift.openedAtLabel}` : ''}
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 items-center justify-center gap-14 p-6">
        <div className="print-receipt w-[500px] rounded-card border border-border bg-surface p-8 shadow-card">
          <h1 className="mb-1.5 text-pos-total font-semibold text-ink">Drawer count</h1>

          {phase === 'count' ? (
            <>
              <p className="mb-6 text-body text-ink-muted">
                Count the drawer <em>blind</em> — the expected cash stays hidden until you submit the count.
              </p>
              <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-muted">
                Counted cash
              </p>
              <div className="mb-6 flex h-[76px] items-center justify-end rounded border-2 border-primary bg-bg px-4 font-money text-[36px] font-semibold text-ink">
                <MoneyText amount={counted} currency={store.currency} />
              </div>
              <Button onClick={() => setPhase('review')} disabled={counted <= 0}>
                Submit count
              </Button>
            </>
          ) : (
            z && (
              <>
                <div className="text-body">
                  <Row label="Opening float" value={<MoneyText amount={z.openingFloat} currency={store.currency} />} />
                  <Row
                    label={`Cash sales (${z.txnCount} order${z.txnCount === 1 ? '' : 's'})`}
                    value={<MoneyText amount={z.tenders.cash} currency={store.currency} />}
                  />
                  {z.cashRefunds > 0 && (
                    <Row label="Cash refunds" value={<MoneyText amount={-z.cashRefunds} currency={store.currency} />} />
                  )}
                  {z.paidIn > 0 && (
                    <Row label="Paid in" value={<MoneyText amount={z.paidIn} currency={store.currency} />} />
                  )}
                  {z.paidOut > 0 && (
                    <Row label="Paid out" value={<MoneyText amount={-z.paidOut} currency={store.currency} />} />
                  )}
                  <Row
                    strong
                    divider
                    label="Expected in drawer"
                    value={<MoneyText amount={z.expectedCash} currency={store.currency} />}
                  />
                  <Row label="Counted (blind)" value={<MoneyText amount={z.countedCash} currency={store.currency} />} />
                </div>

                {canReveal ? (
                  <OverShortReveal overShort={z.overShort} currency={store.currency} />
                ) : (
                  <div className="my-4 rounded border border-border bg-bg px-4 py-3 text-body-sm text-ink-muted">
                    Count recorded — over/short is visible to an Owner. See your manager, or have an Owner reveal it.
                    <button
                      onClick={() => setPinOpen(true)}
                      className="no-print ml-2 font-medium text-primary underline"
                    >
                      Owner: reveal
                    </button>
                  </div>
                )}

                {/* Z-report tender + per-staff breakdown (FR-6.2) */}
                <div className="mt-4 border-t border-border pt-3 text-body-sm">
                  <p className="mb-1 font-semibold uppercase tracking-wide text-ink-muted">Z-report</p>
                  <Row label="Gross sales" value={<MoneyText amount={z.grossSales} currency={store.currency} />} />
                  <Row label="Net sales" value={<MoneyText amount={z.netSales} currency={store.currency} />} />
                  <Row label="Tax collected" value={<MoneyText amount={z.taxCollected} currency={store.currency} />} />
                  <Row label="Discounts" value={<MoneyText amount={z.discounts} currency={store.currency} />} />
                  <Row label="Refunds" value={<MoneyText amount={z.refunds} currency={store.currency} />} />
                  <Row label="Cash tenders" value={<MoneyText amount={z.tenders.cash} currency={store.currency} />} />
                  <Row label="Card tenders" value={<MoneyText amount={z.tenders.card_manual} currency={store.currency} />} />
                </div>

                <div className="no-print mt-6 flex flex-col gap-2">
                  <Button onClick={close} disabled={busy}>
                    Close shift &amp; print Z-report
                  </Button>
                  <Button variant="ghost" onClick={() => setPhase('count')}>
                    Recount drawer
                  </Button>
                </div>
              </>
            )
          )}
        </div>

        {phase === 'count' && (
          <div className="no-print w-[340px] flex-none">
            <NumberPad value={counted} onChange={setCounted} />
          </div>
        )}

        {pinOpen && (
          <div className="no-print fixed inset-0 z-20 flex items-center justify-center bg-ink/40">
            <div className="w-[420px] rounded-card border border-border bg-surface p-6 shadow-overlay">
              <p className="mb-1 text-pos-body font-semibold text-ink">Owner PIN</p>
              <p className="mb-4 text-body-sm text-ink-muted">An Owner can reveal the over/short figure.</p>
              <div className="mb-3 flex gap-2" aria-label="Owner PIN">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={'h-3 w-3 rounded-full ' + (i < pin.length ? 'bg-primary' : 'bg-border')} />
                ))}
              </div>
              {pinError && <p className="mb-2 text-caption text-danger">{pinError}</p>}
              <PinPad
                onDigit={(d) => setPin((p) => (p.length < 6 ? p + d : p))}
                onBackspace={() => setPin((p) => p.slice(0, -1))}
                onClear={() => setPin('')}
                disabled={checking}
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setPinOpen(false); setPin(''); setPinError(null); }}>
                  Cancel
                </Button>
                <Button onClick={approveReveal} disabled={pin.length < 4 || checking}>
                  Reveal
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function OverShortReveal({ overShort, currency }: { overShort: number; currency: string }) {
  if (overShort === 0) {
    return (
      <div className="my-4 rounded border border-[#BFE0C8] bg-[#E7F3EA] px-4 py-3">
        <div className="flex justify-between text-h3 font-semibold text-success">
          <span>Balanced</span>
          <MoneyText amount={0} currency={currency} className="text-success" />
        </div>
      </div>
    );
  }
  const over = overShort > 0;
  return (
    <div className={'my-4 rounded border px-4 py-3 ' + (over ? 'border-[#BFE0C8] bg-[#E7F3EA]' : 'border-[#F3C1BD] bg-[#FCEBEA]')}>
      <div className={'flex justify-between text-h3 font-semibold ' + (over ? 'text-success' : 'text-danger')}>
        <span>{over ? 'Over' : 'Short'}</span>
        <MoneyText amount={overShort} currency={currency} className={over ? 'text-success' : 'text-danger'} />
      </div>
      <p className={'mt-1.5 text-caption ' + (over ? 'text-success' : 'text-[#8C1D14]')}>
        Recorded on the shift with both counts. It appears on the Z-report and in Admin.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  divider,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  divider?: boolean;
}) {
  return (
    <div
      className={
        'flex justify-between py-1.5 ' +
        (divider ? 'mt-1.5 border-t border-border pt-3 ' : '') +
        (strong ? 'font-semibold text-ink' : 'text-ink-muted')
      }
    >
      <span>{label}</span>
      <span className={strong ? 'text-ink' : 'text-ink'}>{value}</span>
    </div>
  );
}
