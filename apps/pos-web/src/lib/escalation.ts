import { verifyPin } from '@retailos/domain';
import type { SqlDriver } from '@retailos/sync';

/**
 * Owner-PIN escalation (FR-5.2, POS-14/POS-08). Phase-1 fixed roles: a Cashier
 * may discount up to 10% (line or cart); anything above — plus refunds, voids,
 * tax-exempt sales — needs an Owner to approve at the register. The check runs
 * against the locally synced argon2id hashes, so it works fully offline.
 */

/** The Cashier discount ceiling as a fraction of the target total (FR-5.2). */
export const CASHIER_DISCOUNT_LIMIT_BP = 1000; // 10%

export function isOwner(roleId: string): boolean {
  return roleId === 'owner';
}

/** True when this discount amount exceeds a Cashier's 10% ceiling on the target. */
export function discountNeedsEscalation(
  roleId: string,
  discountAmount: number,
  targetTotal: number,
): boolean {
  if (isOwner(roleId)) return false;
  if (targetTotal <= 0) return discountAmount > 0;
  return discountAmount * 10_000 > targetTotal * CASHIER_DISCOUNT_LIMIT_BP;
}

/**
 * Verifies the entered PIN against every active Owner and returns the approving
 * Owner's id, or null when no Owner matches. Sequential by design — the owner
 * set is tiny and argon2id is deliberately slow.
 */
export async function verifyOwnerPin(driver: SqlDriver, pin: string): Promise<string | null> {
  const owners = driver.all<{ id: string; pin_hash: string | null }>(
    `SELECT id, pin_hash FROM staff WHERE role_id = 'owner' AND active = 1 AND pin_hash IS NOT NULL`,
  );
  for (const owner of owners) {
    if (owner.pin_hash && (await verifyPin(pin, owner.pin_hash))) return owner.id;
  }
  return null;
}
