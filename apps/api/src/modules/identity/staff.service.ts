import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, asc, eq, ne } from 'drizzle-orm';
import { ulid } from 'ulid';
import { ARGON2_OPTIONS } from '../../common/hashing';
import { assertPermission } from '../../common/permissions';
import { DbService, type TenantTx } from '../../db/db.service';
import { roles, staff } from '../../db/schema';
import type { CreateStaffInput, UpdateStaffInput } from './dto';

/** Admin staff resource — deliberately hash-free (spec 1F decision 2). */
export interface StaffResource {
  id: string;
  name: string;
  email: string | null;
  role_id: string;
  role_name: string;
  active: boolean;
  has_pin: boolean;
  created_at: string;
  updated_at: string;
}

type StaffRow = typeof staff.$inferSelect;

function toResource(row: StaffRow, roleName: string): StaffResource {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role_id: row.roleId,
    role_name: roleName,
    active: row.active,
    has_pin: row.pinHash !== null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function isOwnerRole(permissions: unknown): boolean {
  return (permissions as { owner?: boolean }).owner === true;
}

@Injectable()
export class StaffService {
  constructor(private readonly db: DbService) {}

  async list(storeId: string, callerStaffId: string): Promise<StaffResource[]> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, callerStaffId, 'staff_edit');
      const rows = await tx
        .select({ staff: staff, roleName: roles.name })
        .from(staff)
        .innerJoin(roles, eq(staff.roleId, roles.id))
        .orderBy(asc(staff.id));
      return rows.map((r) => toResource(r.staff, r.roleName));
    });
  }

  async listRoles(storeId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db.tenants
      .forStore(storeId)
      .tx((tx) => tx.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)));
  }

  async create(storeId: string, callerStaffId: string, input: CreateStaffInput): Promise<StaffResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, callerStaffId, 'staff_edit');
      const role = await this.requireRole(tx, input.role_id);
      if (input.email) {
        const dup = await tx.select({ id: staff.id }).from(staff).where(eq(staff.email, input.email));
        if (dup.length > 0) throw new ConflictException('A staff member with this email already exists');
      }
      const rows = await tx
        .insert(staff)
        .values({
          id: ulid(),
          storeId,
          name: input.name,
          email: input.email ?? null,
          roleId: input.role_id,
        })
        .returning();
      return toResource(rows[0]!, role.name);
    });
  }

  async update(storeId: string, callerStaffId: string, id: string, input: UpdateStaffInput): Promise<StaffResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      await assertPermission(tx, callerStaffId, 'staff_edit');
      const current = await tx
        .select({ staff: staff, permissions: roles.permissions })
        .from(staff)
        .innerJoin(roles, eq(staff.roleId, roles.id))
        .where(eq(staff.id, id));
      const target = current[0];
      if (!target) throw new NotFoundException('Staff member not found');

      if (input.active === false && id === callerStaffId) {
        throw new ForbiddenException('You cannot deactivate your own account');
      }

      const newRole = input.role_id !== undefined ? await this.requireRole(tx, input.role_id) : null;

      // Golden guard: the store must keep at least one active owner-role
      // staff member, or nobody can manage staff/settings ever again.
      const wasActiveOwner = target.staff.active && isOwnerRole(target.permissions);
      const staysOwner =
        (input.active ?? target.staff.active) &&
        isOwnerRole(newRole ? newRole.permissions : target.permissions);
      if (wasActiveOwner && !staysOwner) {
        // Lock all active staff rows FOR UPDATE before counting owners: two
        // concurrent demotions could otherwise each see "another owner exists"
        // and both commit, leaving zero active owners (permanent lockout).
        // The lock serializes the check-then-update pairs; a deadlock abort on
        // a pathological concurrent pair is acceptable, silent invariant loss
        // is not. Locked separately because FOR UPDATE can't target a join.
        await tx.select({ id: staff.id }).from(staff).where(eq(staff.active, true)).for('update');
        const others = await tx
          .select({ id: staff.id, permissions: roles.permissions })
          .from(staff)
          .innerJoin(roles, eq(staff.roleId, roles.id))
          .where(and(eq(staff.active, true), ne(staff.id, id)));
        if (!others.some((o) => isOwnerRole(o.permissions))) {
          throw new ForbiddenException('At least one active Owner is required');
        }
      }

      const rows = await tx
        .update(staff)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role_id !== undefined ? { roleId: input.role_id } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          updatedAt: new Date(),
        })
        .where(eq(staff.id, id))
        .returning();
      const roleName = newRole
        ? newRole.name
        : (await tx.select({ name: roles.name }).from(roles).where(eq(roles.id, rows[0]!.roleId)))[0]!.name;
      return toResource(rows[0]!, roleName);
    });
  }

  async setPin(storeId: string, callerStaffId: string, id: string, pin: string): Promise<StaffResource> {
    return this.db.tenants.forStore(storeId).tx(async (tx) => {
      // Authorize and confirm the target exists BEFORE hashing: argon2id costs
      // 19 MiB of memory and real CPU per call, so an unauthorized session or
      // a bogus target id must not be able to force that work.
      await assertPermission(tx, callerStaffId, 'staff_edit');
      const existing = await tx.select({ id: staff.id }).from(staff).where(eq(staff.id, id));
      if (!existing[0]) throw new NotFoundException('Staff member not found');
      const pinHash = await argon2.hash(pin, ARGON2_OPTIONS);
      const rows = await tx
        .update(staff)
        .set({ pinHash, updatedAt: new Date() })
        .where(eq(staff.id, id))
        .returning();
      const row = rows[0];
      if (!row) throw new NotFoundException('Staff member not found');
      const role = (await tx.select({ name: roles.name }).from(roles).where(eq(roles.id, row.roleId)))[0]!;
      return toResource(row, role.name);
    });
  }

  private async requireRole(
    tx: TenantTx,
    roleId: string,
  ): Promise<{ id: string; name: string; permissions: unknown }> {
    const rows = await tx
      .select({ id: roles.id, name: roles.name, permissions: roles.permissions })
      .from(roles)
      .where(eq(roles.id, roleId));
    if (!rows[0]) throw new NotFoundException('Role not found');
    return rows[0];
  }
}
