import { argon2Verify } from 'hash-wasm';

/**
 * Verifies a register PIN against the argon2id encoded hash synced from the
 * server (FR-5.1). hash-wasm is pure WASM, so verification runs identically
 * in the browser (pos-web) and Node/Electron — offline verification is
 * non-negotiable. React Native needs its own adapter (mobile phase).
 *
 * Absent or corrupt hashes verify false rather than throwing: a bad synced
 * row must never crash the lock screen.
 */
export async function verifyPin(pin: string, pinHash: string | null | undefined): Promise<boolean> {
  if (!pinHash || !/^\d{4,6}$/.test(pin)) return false;
  try {
    return await argon2Verify({ password: pin, hash: pinHash });
  } catch {
    return false;
  }
}
