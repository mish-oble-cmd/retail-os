import { Badge, NumberPad } from '@retailos/ui';
import { useEffect, useState } from 'react';

/**
 * POS-02 PIN lock (Phase 0 shell): static PIN via VITE_STATIC_PIN (default
 * 1234) — real per-staff PINs arrive with register activation in Phase 1.
 */
const STATIC_PIN = (import.meta.env['VITE_STATIC_PIN'] as string | undefined) ?? '1234';

export function PinLockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState(0);
  const [shake, setShake] = useState(false);
  const digits = pin === 0 ? '' : String(pin);

  useEffect(() => {
    if (digits.length < STATIC_PIN.length) return;
    if (digits === STATIC_PIN) {
      setPin(0);
      onUnlock();
    } else {
      setShake(true);
      const timer = setTimeout(() => {
        setPin(0);
        setShake(false);
      }, 350);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [digits, onUnlock]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h1 className="text-h2 font-semibold text-ink">Bahay Kubo Grocers</h1>
        <p className="text-pos-body text-ink-muted">Register 2 · enter your PIN</p>
      </div>
      <Badge tone="success">● Online</Badge>
      <div
        className={`flex h-16 w-64 items-center justify-center rounded-card border bg-surface text-h1 tracking-[0.6em] ${
          shake ? 'border-danger text-danger' : 'border-border text-ink'
        }`}
        aria-label="PIN entry"
      >
        {'•'.repeat(digits.length) || <span className="text-body text-ink-muted">PIN</span>}
      </div>
      <NumberPad value={pin} onChange={setPin} doubleZero={false} max={999999} className="w-64" />
      <button
        type="button"
        className="text-body-sm text-ink-muted underline-offset-2 hover:underline"
        onClick={() => document.documentElement.requestFullscreen?.()}
      >
        Enter fullscreen
      </button>
    </main>
  );
}
