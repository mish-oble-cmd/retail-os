import { useEffect } from 'react';

/** FR-5.1: auto-lock to the PIN screen after 90 s of inactivity (Phase 1 fixed). */
export const IDLE_LOCK_MS = 90_000;

export function useIdleLock(enabled: boolean, onLock: () => void): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = setTimeout(onLock, IDLE_LOCK_MS);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onLock, IDLE_LOCK_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, reset, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [enabled, onLock]);
}
