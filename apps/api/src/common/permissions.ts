import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { TenantTx } from '../db/db.service';
import { roles, staff } from '../db/schema';

/**
 * Permission flags stored in roles.permissions JSONB (FR-5.2). Phase 1 ships
 * fixed roles — Owner `{ owner: true }` passes every check; the flag names
 * exist so the Phase 2 permission editor slots in without touching call sites.
 */
export type PermissionFlag = 'catalog_edit' | 'settings_edit' | 'registers_edit' | 'staff_edit';

interface PermissionFlags {
  owner?: boolean;
  [flag: string]: unknown;
}

/**
 * Runs inside the caller's tenant transaction so the permission check and the
 * mutation it guards commit (or fail) together.
 */
export async function assertPermission(
  tx: TenantTx,
  staffId: string,
  flag: PermissionFlag,
): Promise<void> {
  const rows = await tx
    .select({ active: staff.active, permissions: roles.permissions })
    .from(staff)
    .innerJoin(roles, eq(staff.roleId, roles.id))
    .where(eq(staff.id, staffId));
  const row = rows[0];
  if (!row || !row.active) throw new UnauthorizedException('Session no longer valid');
  // why cast: permissions is schemaless JSONB by design (FR-5.2 custom roles);
  // shape is validated where roles are written, tolerated where read.
  const permissions = row.permissions as PermissionFlags;
  if (permissions.owner !== true && permissions[flag] !== true) {
    throw new ForbiddenException(`This action requires the ${flag} permission`);
  }
}
