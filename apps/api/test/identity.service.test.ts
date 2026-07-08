/**
 * Identity flows against real SQL (PGlite): minimal Phase 0 signup → login →
 * TOTP enrollment/activation. Services are constructed directly — no Nest DI
 * needed in unit-level tests.
 */
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbService } from '../src/db/db.service';
import { IdentityService } from '../src/modules/identity/identity.service';
import { createTestDb } from './pglite';

let db: Awaited<ReturnType<typeof createTestDb>>;
let identity: IdentityService;

beforeAll(async () => {
  db = await createTestDb();
  // Structural stand-in: IdentityService only touches db.tenants.
  identity = new IdentityService({ tenants: db.tenants } as unknown as DbService);
});

afterAll(async () => {
  await db.close();
});

const signupInput = {
  email: 'aling.nena@example.ph',
  password: 'kape-barako-1250',
  storeName: 'Bahay Kubo Grocers',
  currency: 'PHP',
};

describe('identity service', () => {
  it('signup creates store + Owner and yields an identity', async () => {
    const created = await identity.signup(signupInput);
    expect(created.storeId).toBeTruthy();
    expect(created.roleName).toBe('Owner');

    const me = await identity.me(created.storeId, created.staffId);
    expect(me.email).toBe(signupInput.email);
  });

  it('rejects duplicate signup emails', async () => {
    await expect(identity.signup(signupInput)).rejects.toThrow(/already exists/);
  });

  it('login succeeds with the right password and fails uniformly otherwise', async () => {
    const ok = await identity.login(signupInput.email, signupInput.password);
    expect(ok.roleName).toBe('Owner');

    await expect(identity.login(signupInput.email, 'wrong-password')).rejects.toThrow(
      /Invalid email or password/,
    );
    await expect(identity.login('nobody@example.ph', 'whatever-123')).rejects.toThrow(
      /Invalid email or password/,
    );
  });

  it('TOTP enrollment gates login once activated', async () => {
    const session = await identity.login(signupInput.email, signupInput.password);
    const enrollment = await identity.totpEnroll(session.storeId, session.staffId);
    expect(enrollment.otpauthUrl).toContain('otpauth://totp/');

    // wrong code does not activate
    await expect(
      identity.totpActivate(session.storeId, session.staffId, '000000'),
    ).rejects.toThrow();

    await identity.totpActivate(
      session.storeId,
      session.staffId,
      authenticator.generate(enrollment.secret),
    );

    // now login requires a code…
    await expect(identity.login(signupInput.email, signupInput.password)).rejects.toThrow(
      /authenticator code/,
    );
    // …and works with one
    const withCode = await identity.login(
      signupInput.email,
      signupInput.password,
      authenticator.generate(enrollment.secret),
    );
    expect(withCode.staffId).toBe(session.staffId);
  });
});
