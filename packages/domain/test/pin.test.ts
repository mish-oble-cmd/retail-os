import { argon2id } from 'hash-wasm';
import { describe, expect, it } from 'vitest';
import { verifyPin } from '../src/auth/pin.js';

async function hashPin(pin: string): Promise<string> {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  // Same cost profile the server uses (OWASP argon2id baseline).
  return argon2id({
    password: pin,
    salt,
    parallelism: 1,
    iterations: 2,
    memorySize: 19_456,
    hashLength: 32,
    outputType: 'encoded',
  });
}

describe('verifyPin', () => {
  it('accepts the right PIN and rejects a wrong one', async () => {
    const hash = await hashPin('0042'); // leading zero on purpose
    expect(await verifyPin('0042', hash)).toBe(true);
    expect(await verifyPin('4200', hash)).toBe(false);
  });

  it('rejects without throwing on missing or corrupt hashes', async () => {
    expect(await verifyPin('1234', null)).toBe(false);
    expect(await verifyPin('1234', undefined)).toBe(false);
    expect(await verifyPin('1234', 'not-an-argon2-hash')).toBe(false);
  });

  it('rejects non-PIN inputs before touching the hash', async () => {
    const hash = await hashPin('123456');
    expect(await verifyPin('123456', hash)).toBe(true);
    expect(await verifyPin('12345678', hash)).toBe(false); // 8 digits
    expect(await verifyPin('12a4', hash)).toBe(false);
  });
});
