import { verifyPin } from '@retailos/domain';
import { Badge, cn } from '@retailos/ui';
import { useEffect, useMemo, useState } from 'react';
import { PinPad } from '../components/PinPad';
import {
  COOLDOWN_MS,
  initialPinLockState,
  isCoolingDown,
  recordFailure,
  remainingCooldownMs,
  type PinLockState,
} from '../lib/pin-lock';
import type { StaffDirectory, StaffEntry } from '../lib/staff-directory';

/** How long the wrong-PIN shake plays before the dots reset (mockup: 120ms per
 * oscillation; matches the `shake` keyframe duration in tailwind.config.cjs). */
const SHAKE_MS = 350;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function roleLabel(roleId: string): string {
  return roleId.length === 0 ? roleId : roleId[0]!.toUpperCase() + roleId.slice(1);
}

/**
 * POS-02 PIN lock (real, Phase 1): staff pick a tile, then their PIN
 * auto-verifies device-side via `verifyPin` (argon2id, offline) from the
 * 4th digit — no confirm tap. Wrong entries throttle into a cooldown, never
 * a lockout (FR-5.1 / approved 04-design/mockups/pos--pin-lock.html).
 */
export function PinLockScreen({
  directory,
  storeName,
  registerName,
  onUnlock,
}: {
  directory: StaffDirectory;
  storeName: string;
  registerName: string;
  onUnlock: (staff: { id: string; name: string }) => void;
}) {
  const [staff, setStaff] = useState<StaffEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [shake, setShake] = useState(false);
  const [pinLockState, setPinLockState] = useState<PinLockState>(initialPinLockState());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    directory.listStaff().then((list) => {
      if (!cancelled) setStaff(list);
    });
    return () => {
      cancelled = true;
    };
  }, [directory]);

  const selected = useMemo(() => staff?.find((s) => s.id === selectedId) ?? null, [staff, selectedId]);
  const cooling = isCoolingDown(pinLockState, now);

  // Cooldown countdown ticker — re-renders once a second so "Try again in Ns"
  // counts down and the pad re-enables the instant the cooldown lapses.
  useEffect(() => {
    if (!cooling) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [cooling]);

  function recordMiss(): void {
    setPinLockState((s) => recordFailure(s, Date.now()));
    setShake(true);
    setPin('');
    window.setTimeout(() => setShake(false), SHAKE_MS);
  }

  // Auto-verify from the 4th digit. A 4- or 5-digit prefix that doesn't match
  // yet isn't necessarily wrong (PINs may be 4-6 digits) — only a full 6-digit
  // entry that still fails is a confirmed miss.
  //
  // Race guard: `ignore` is captured per effect run and flipped by its own
  // cleanup the instant `pin`/`selected` change again (new digit, staff
  // switch, clear, or escape) — so a verifyPin() that resolves after the user
  // has moved on is always discarded, never unlocking or missing stale state.
  useEffect(() => {
    if (!selected || cooling || pin.length < 4) return undefined;
    let ignore = false;
    const attemptedPin = pin;
    const attemptedStaff = selected;
    verifyPin(attemptedPin, attemptedStaff.pinHash).then((ok) => {
      if (ignore) return;
      if (ok) {
        setPin('');
        setSelectedId(null);
        setPinLockState(initialPinLockState());
        onUnlock({ id: attemptedStaff.id, name: attemptedStaff.name });
      } else if (attemptedPin.length === 6) {
        recordMiss();
      }
    });
    return () => {
      ignore = true;
    };
  }, [pin, selected, cooling]);

  function handleSelectStaff(entry: StaffEntry): void {
    if (!entry.active || entry.pinHash === null) return;
    if (pin.length >= 4) recordMiss();
    else setPin('');
    setSelectedId(entry.id);
  }

  function handleDigit(d: string): void {
    if (cooling || pin.length >= 6) return;
    setPin((p) => p + d);
  }

  function handleBackspace(): void {
    if (cooling) return;
    setPin((p) => p.slice(0, -1));
  }

  function handleClear(): void {
    if (pin.length >= 4) recordMiss();
    else setPin('');
  }

  function handleBack(): void {
    if (pin.length >= 4) recordMiss();
    else setPin('');
    setSelectedId(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!selected) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleBack();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handleDigit(e.key);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, pin, cooling]);

  const dotCount = Math.min(6, Math.max(4, pin.length));
  const attemptsLeft = pinLockState.attemptsLeft;

  return (
    <main className="flex min-h-screen flex-col">
      <header className="flex h-14 flex-none items-center gap-4 px-6">
        <div>
          <p className="text-pos-body font-semibold leading-tight text-ink">{storeName}</p>
          <p className="text-caption text-ink-muted">{registerName}</p>
        </div>
        <Badge tone="success" className="ml-auto">
          ● Online
        </Badge>
      </header>

      <div className="flex flex-1 items-center justify-center gap-16 px-6">
        <div className="w-80">
          <h2 className="mb-4 text-h3 font-semibold text-ink">Who&apos;s selling?</h2>
          {staff === null ? (
            <p className="text-body-sm text-ink-muted">Loading staff…</p>
          ) : (
            <ul className="space-y-2">
              {staff.map((s) => {
                const disabled = !s.active || s.pinHash === null;
                const caption = !s.active ? 'Deactivated — see Admin' : s.pinHash === null ? 'No PIN set' : roleLabel(s.roleId);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => handleSelectStaff(s)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-card border-2 border-transparent p-3 text-left',
                        selectedId === s.id && 'border-primary bg-surface shadow-card',
                        disabled && 'opacity-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-14 w-14 flex-none items-center justify-center rounded-full text-h3 font-semibold text-white',
                          disabled ? 'bg-ink-muted' : 'bg-primary',
                        )}
                      >
                        {initials(s.name)}
                      </span>
                      <span>
                        <span className="block text-pos-body font-medium text-ink">{s.name}</span>
                        <span className="block text-body-sm text-ink-muted">{caption}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected ? (
          <div className="w-80 text-center">
            <div
              className={cn(
                'mb-2 flex h-6 items-center justify-center gap-4',
                shake && 'motion-reduce:animate-none animate-shake',
              )}
              aria-label="PIN entry"
            >
              {Array.from({ length: dotCount }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-[18px] w-[18px] rounded-full border-2 border-border bg-surface',
                    i < pin.length && (shake ? 'border-danger bg-danger' : 'border-primary bg-primary'),
                  )}
                />
              ))}
            </div>
            {cooling ? (
              <p className="mb-5 text-body-sm font-medium text-danger">
                Try again in {Math.ceil(remainingCooldownMs(pinLockState, now) / 1000)}s
              </p>
            ) : attemptsLeft <= 2 ? (
              <p className="mb-5 text-body-sm font-medium text-danger">
                {attemptsLeft} {attemptsLeft === 1 ? 'try' : 'tries'} left before a {COOLDOWN_MS / 1000}-second wait
              </p>
            ) : (
              <p className="mb-5 text-body-sm text-ink-muted">Enter your PIN</p>
            )}
            <PinPad onDigit={handleDigit} onBackspace={handleBackspace} onClear={handleClear} disabled={cooling} />
          </div>
        ) : (
          <div className="w-80" aria-hidden />
        )}
      </div>

      <button
        type="button"
        className="pb-4 text-body-sm text-ink-muted underline-offset-2 hover:underline"
        onClick={() => document.documentElement.requestFullscreen?.()}
      >
        Enter fullscreen
      </button>
    </main>
  );
}
