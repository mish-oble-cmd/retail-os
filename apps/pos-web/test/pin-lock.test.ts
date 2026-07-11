import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_MS,
  MAX_ATTEMPTS,
  initialPinLockState,
  isCoolingDown,
  recordFailure,
  remainingCooldownMs,
} from '../src/lib/pin-lock';

describe('pin lock throttle (POS-02: cooldown, never lockout)', () => {
  it('allows MAX_ATTEMPTS misses, then imposes a cooldown', () => {
    let state = initialPinLockState();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) {
      state = recordFailure(state, 1_000 + i);
      expect(isCoolingDown(state, 1_000 + i)).toBe(false);
    }
    state = recordFailure(state, 5_000);
    expect(isCoolingDown(state, 5_000)).toBe(true);
    expect(remainingCooldownMs(state, 5_000)).toBe(COOLDOWN_MS);
  });

  it('cooldown expires and grants a fresh attempt budget — never bricked', () => {
    let state = initialPinLockState();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) state = recordFailure(state, 0);
    expect(isCoolingDown(state, COOLDOWN_MS - 1)).toBe(true);
    expect(isCoolingDown(state, COOLDOWN_MS)).toBe(false);
    expect(state.attemptsLeft).toBe(MAX_ATTEMPTS);
  });

  it('a success resets everything', () => {
    let state = recordFailure(initialPinLockState(), 0);
    state = initialPinLockState(); // screen resets on unlock
    expect(state.attemptsLeft).toBe(MAX_ATTEMPTS);
    expect(isCoolingDown(state, 0)).toBe(false);
  });
});
