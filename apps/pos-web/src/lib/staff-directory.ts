import { argon2id } from 'hash-wasm';
import type { SqlDriver } from '@retailos/sync';

/**
 * Where the lock screen gets its staff. 1C implements this over the synced
 * device mirror; until then the demo directory hashes fixed PINs at startup
 * (same argon2id cost profile the server uses) so verifyPin exercises the
 * real path end to end.
 */
export interface StaffEntry {
  id: string;
  name: string;
  roleId: string;
  pinHash: string | null;
  active: boolean;
}

export interface StaffDirectory {
  listStaff(): Promise<StaffEntry[]>;
}

async function demoHash(pin: string): Promise<string> {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
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

/**
 * Reads staff from the synced device mirror (1C). The lock screen verifies the
 * entered PIN against each `pin_hash` via `verifyPin` — the same offline
 * argon2id check the demo directory exercised, now over real device rows.
 */
export function deviceStaffDirectory(driver: SqlDriver): StaffDirectory {
  return {
    listStaff: async () =>
      driver
        .all<{ id: string; name: string; role_id: string; pin_hash: string | null; active: number }>(
          `SELECT id, name, role_id, pin_hash, active FROM staff ORDER BY name`,
        )
        .map((row) => ({
          id: row.id,
          name: row.name,
          roleId: row.role_id,
          pinHash: row.pin_hash,
          active: row.active === 1,
        })),
  };
}

/** Demo data until 1C wires the device mirror. Ana 0042, Ben 1234. */
export function demoStaffDirectory(): StaffDirectory {
  const staff = (async (): Promise<StaffEntry[]> => [
    { id: 'DEMO-ANA', name: 'Ana', roleId: 'owner', pinHash: await demoHash('0042'), active: true },
    { id: 'DEMO-BEN', name: 'Ben', roleId: 'cashier', pinHash: await demoHash('1234'), active: true },
    { id: 'DEMO-CARA', name: 'Cara', roleId: 'cashier', pinHash: null, active: true },
    { id: 'DEMO-DENG', name: 'Deng', roleId: 'cashier', pinHash: await demoHash('9999'), active: false },
  ])();
  return { listStaff: () => staff };
}
