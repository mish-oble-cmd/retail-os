import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { authenticator } from 'otplib';
import { ulid } from 'ulid';
import { DbService } from '../../db/db.service';
import { roles, staff, stores, taxCategories, taxRates } from '../../db/schema';

export interface SignupInput {
  email: string;
  password: string;
  storeName: string;
  currency: string;
}

export interface Identity {
  staffId: string;
  storeId: string;
  name: string;
  email: string;
  roleName: string;
}

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB — OWASP-recommended argon2id baseline
  timeCost: 2,
  parallelism: 1,
};

/**
 * Convenience default for the seeded "Standard" tax category; the onboarding
 * wizard (FR-10.1) and ADM-17 let the owner change it. Rates stay fully
 * per-store adjustable — this only picks a sensible starting point.
 */
const DEFAULT_TAX_BY_CURRENCY: Record<string, { name: string; rateBp: number }> = {
  SGD: { name: 'GST 9%', rateBp: 900 },
  PHP: { name: 'VAT 12%', rateBp: 1200 },
};

@Injectable()
export class IdentityService {
  constructor(private readonly db: DbService) {}

  /**
   * Minimal Phase 0 signup (approved): store + Owner role + owner staff in one
   * transaction. Cross-tenant because the tenant does not exist yet.
   */
  async signup(input: SignupInput): Promise<Identity> {
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const storeId = ulid();
    const roleId = ulid();
    const staffId = ulid();

    return this.db.tenants.dangerouslyCrossTenant(
      'signup: tenant does not exist until this transaction commits',
      async (tx) => {
        const existing = await tx
          .select({ id: staff.id })
          .from(staff)
          .where(eq(staff.email, input.email));
        if (existing.length > 0) {
          // Phase 0: email is the global login key; per-store reuse arrives with
          // multi-store accounts (documented in api-design.md TODO).
          throw new ConflictException('An account with this email already exists');
        }
        await tx.insert(stores).values({
          id: storeId,
          name: input.storeName,
          currency: input.currency,
        });
        await tx.insert(roles).values({
          id: roleId,
          storeId,
          name: 'Owner',
          permissions: { owner: true },
        });
        // Fixed Phase 1 roles (FR-5.2): Cashier caps discounts at 10%; everything
        // else needs Owner escalation at the register. Editor arrives Phase 2.
        await tx.insert(roles).values({
          id: ulid(),
          storeId,
          name: 'Cashier',
          permissions: { cashier: true, max_discount_pct: 10 },
        });
        await tx.insert(staff).values({
          id: staffId,
          storeId,
          name: input.email.split('@')[0] ?? input.email,
          email: input.email,
          passwordHash,
          roleId,
        });
        // Catalog needs a tax category to reference from the first product
        // (products.tax_category_id NOT NULL); "Standard" + a currency-based
        // starting rate, both editable in ADM-17.
        const taxCategoryId = ulid();
        const defaultRate = DEFAULT_TAX_BY_CURRENCY[input.currency] ?? {
          name: 'No tax',
          rateBp: 0,
        };
        await tx.insert(taxCategories).values({
          id: taxCategoryId,
          storeId,
          name: 'Standard',
        });
        await tx.insert(taxRates).values({
          id: ulid(),
          storeId,
          taxCategoryId,
          name: defaultRate.name,
          rateBp: defaultRate.rateBp,
        });
        return { staffId, storeId, name: input.email, email: input.email, roleName: 'Owner' };
      },
    );
  }

  /** Login by email — cross-tenant lookup, then everything else store-scoped. */
  async login(email: string, password: string, totpCode?: string): Promise<Identity> {
    const row = await this.db.tenants.dangerouslyCrossTenant(
      'login: staff row must be found before a tenant context exists',
      async (tx) => {
        const rows = await tx
          .select({
            id: staff.id,
            storeId: staff.storeId,
            name: staff.name,
            email: staff.email,
            passwordHash: staff.passwordHash,
            totpEnabled: staff.totpEnabled,
            totpSecret: staff.totpSecret,
            roleName: roles.name,
          })
          .from(staff)
          .innerJoin(roles, eq(staff.roleId, roles.id))
          .where(and(eq(staff.email, email), eq(staff.active, true)));
        return rows[0];
      },
    );

    // Uniform failure: never reveal whether the email exists.
    if (!row?.passwordHash || !(await argon2.verify(row.passwordHash, password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (row.totpEnabled) {
      if (
        !totpCode ||
        !row.totpSecret ||
        !authenticator.verify({ token: totpCode, secret: row.totpSecret })
      ) {
        throw new UnauthorizedException('A valid authenticator code is required');
      }
    }
    return {
      staffId: row.id,
      storeId: row.storeId,
      name: row.name,
      email: row.email ?? email,
      roleName: row.roleName,
    };
  }

  async me(storeId: string, staffId: string): Promise<Identity> {
    const row = await this.db.tenants.forStore(storeId).tx(async (tx) => {
      const rows = await tx
        .select({
          id: staff.id,
          storeId: staff.storeId,
          name: staff.name,
          email: staff.email,
          roleName: roles.name,
        })
        .from(staff)
        .innerJoin(roles, eq(staff.roleId, roles.id))
        .where(eq(staff.id, staffId));
      return rows[0];
    });
    if (!row) throw new UnauthorizedException('Session no longer valid');
    return {
      staffId: row.id,
      storeId: row.storeId,
      name: row.name,
      email: row.email ?? '',
      roleName: row.roleName,
    };
  }

  /** TOTP enrollment (optional in Phase 0; enforced for Owner from Phase 1). */
  async totpEnroll(
    storeId: string,
    staffId: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    const updated = await this.db.tenants.forStore(storeId).tx(async (tx) => {
      return tx
        .update(staff)
        .set({ totpSecret: secret, totpEnabled: false, updatedAt: new Date() })
        .where(eq(staff.id, staffId))
        .returning({ email: staff.email });
    });
    const account = updated[0]?.email ?? staffId;
    return { secret, otpauthUrl: authenticator.keyuri(account, 'RetailOS', secret) };
  }

  async totpActivate(storeId: string, staffId: string, code: string): Promise<void> {
    const activated = await this.db.tenants.forStore(storeId).tx(async (tx) => {
      const rows = await tx
        .select({ totpSecret: staff.totpSecret })
        .from(staff)
        .where(eq(staff.id, staffId));
      const secret = rows[0]?.totpSecret;
      if (!secret || !authenticator.verify({ token: code, secret })) return false;
      await tx
        .update(staff)
        .set({ totpEnabled: true, updatedAt: new Date() })
        .where(eq(staff.id, staffId));
      return true;
    });
    if (!activated) throw new UnauthorizedException('Authenticator code did not match');
  }
}
