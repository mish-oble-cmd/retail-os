import { openShift, type SqlDriver, type StoreMeta } from '@retailos/sync';
import { Button, MoneyText, NumberPad } from '@retailos/ui';
import { useState } from 'react';
import { ulid } from 'ulid';
import { DEMO_LOCATION_ID, DEMO_REGISTER_ID } from '../lib/device';

/**
 * POS-10 Shift open. Count the drawer float before the first sale (FR-6.1): tap
 * denomination chips to add bills/coins in stacks, or type a total on the pad.
 * One open shift per register — the Sell screen is locked behind this. Yesterday's
 * float is a hint, never prefilled: the point is a real count.
 */

interface ShiftOpenScreenProps {
  driver: SqlDriver;
  store: StoreMeta;
  staff: { id: string; name: string };
  registerName: string;
  previousFloat?: number | null;
  onOpened: (shift: { id: string; openingFloat: number }) => void;
}

const DENOMS = [100000, 50000, 10000, 5000, 2000, 1000]; // ₱1000 … ₱10 in centavos

export function ShiftOpenScreen({
  driver,
  store,
  staff,
  registerName,
  previousFloat,
  onOpened,
}: ShiftOpenScreenProps) {
  const [amount, setAmount] = useState(0);
  const [busy, setBusy] = useState(false);

  const open = () => {
    setBusy(true);
    const id = ulid();
    const seq =
      driver.get<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) + 1 AS n FROM shifts`)?.n ?? 1;
    openShift(driver, {
      id,
      registerId: DEMO_REGISTER_ID,
      locationId: DEMO_LOCATION_ID,
      openedByStaffId: staff.id,
      openingFloat: amount,
      clientCreatedAt: new Date().toISOString(),
      localSeq: seq,
    });
    onOpened({ id, openingFloat: amount });
  };

  const now = new Date().toLocaleString('en-PH', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex h-screen flex-col bg-bg">
      <header className="flex h-14 flex-none items-center gap-4 border-b border-border bg-surface px-4">
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">Open shift</p>
          <p className="text-caption text-ink-muted">
            {registerName} · {store.name} · {now}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-full border border-border py-1.5 pl-1.5 pr-3 text-body-sm font-medium">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-caption font-semibold text-white">
            {initials(staff.name)}
          </span>
          {staff.name}
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 items-center justify-center gap-14 p-6">
        <div className="w-[500px] rounded-card border border-border bg-surface p-8 shadow-card">
          <h1 className="mb-1.5 text-pos-total font-semibold text-ink">Count the float</h1>
          <p className="mb-6 text-body text-ink-muted">
            Cash in the drawer before selling starts.
            {previousFloat != null && (
              <>
                {' '}
                Yesterday's close left{' '}
                <strong className="text-ink">
                  <MoneyText amount={previousFloat} currency={store.currency} />
                </strong>{' '}
                as float.
              </>
            )}
          </p>

          <p className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-ink-muted">
            Float amount
          </p>
          <div className="mb-4 flex h-[76px] items-center justify-end rounded border-2 border-primary bg-bg px-4 font-money text-[36px] font-semibold text-ink">
            <MoneyText amount={amount} currency={store.currency} />
          </div>

          <p className="mb-1.5 text-body-sm text-ink-muted">Tap to add — counting by denomination:</p>
          <div className="flex flex-wrap gap-2">
            {DENOMS.map((d) => (
              <button
                key={d}
                onClick={() => setAmount((a) => a + d)}
                className="h-12 rounded-full border border-border bg-surface px-4 font-money text-body text-ink hover:border-primary"
              >
                +{Math.round(d / 100)}
              </button>
            ))}
            <button
              onClick={() => setAmount(0)}
              className="h-12 rounded-full border border-border bg-surface px-4 text-body-sm text-ink-muted hover:border-danger hover:text-danger"
            >
              Clear
            </button>
          </div>

          <div className="mt-6">
            <Button onClick={open} disabled={busy}>
              Open shift with <MoneyText amount={amount} currency={store.currency} />
            </Button>
          </div>
        </div>

        <div className="w-[340px] flex-none">
          <NumberPad value={amount} onChange={setAmount} />
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 2);
}
