/**
 * Wrong-PIN throttle per approved POS-02: 5 misses → 30 s cooldown → fresh
 * budget. Cooldown, never lockout — a register mid-rush must not be bricked.
 * Pure and clock-injected so it tests without timers.
 */
export const MAX_ATTEMPTS = 5;
export const COOLDOWN_MS = 30_000;

export interface PinLockState {
  attemptsLeft: number;
  cooldownUntil: number | null;
}

export function initialPinLockState(): PinLockState {
  return { attemptsLeft: MAX_ATTEMPTS, cooldownUntil: null };
}

export function recordFailure(state: PinLockState, now: number): PinLockState {
  const attemptsLeft = state.attemptsLeft - 1;
  if (attemptsLeft <= 0) {
    return { attemptsLeft: MAX_ATTEMPTS, cooldownUntil: now + COOLDOWN_MS };
  }
  return { attemptsLeft, cooldownUntil: null };
}

export function isCoolingDown(state: PinLockState, now: number): boolean {
  return state.cooldownUntil !== null && now < state.cooldownUntil;
}

export function remainingCooldownMs(state: PinLockState, now: number): number {
  return state.cooldownUntil === null ? 0 : Math.max(0, state.cooldownUntil - now);
}
