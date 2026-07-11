# 1F Staff PIN — design (2026-07-11, user-approved)

Workstream 1F of Phase 1 (`05-roadmap/phase-1-core-pos-mvp.md`): staff CRUD in
admin, PIN hash sync, PIN lock + attribution on every order. Phase 1 roles are
fixed (Owner/Cashier); the permission editor, custom roles, and audit log are
Phase 2 (ADM-15 proper, FR-5.2/5.3).

## What already exists (1A/1B)

- `staff` table with `pin_hash` column; `roles.permissions` JSONB;
  `assertPermission(tx, staffId, flag)` where `{ owner: true }` passes every check
- Staff sync-down projection (`id, name, role_id, pin_hash, active`) in
  bootstrap + delta feed — password/TOTP material never leaves the server
- `orders.staff_id` (nullable) through the whole fact pipeline
  (`LocalSaleInput.staffId` → outbox → `/sync/batches` → `orders`)
- argon2id at OWASP baseline (`memoryCost 19456 KiB`) in the identity module
- pos-web Phase-0 placeholder `PinLockScreen` (unlocks unconditionally)
- Approved mockup POS-02 `pos--pin-lock.html`: staff avatars → pin pad,
  wrong-PIN **cooldown rather than lockout** ("a register mid-rush must never
  be bricked"), deactivated staff visible-but-disabled, offline pill with
  queued count

## Decisions

1. **Cashier role seeding.** Signup seeds a `Cashier` role next to `Owner`:
   `{ cashier: true, max_discount_pct: 10 }` (FR-5.2 Phase-1 note — sell,
   park/retrieve, custom sale, discounts ≤ 10%, own-shift ops; everything else
   needs Owner escalation). Migration `0004_staff.sql` backfills the Cashier
   role for existing stores. Role rows stay non-editable until Phase 2.
2. **Staff endpoints** in a new `staff` module, all guarded by a new
   `staff_edit` permission flag (Owner-only in Phase 1; flag added to
   `PermissionFlag`):
   - `GET /staff` — list (id, name, email, role, active, `has_pin` boolean)
   - `POST /staff` — name, `role_id`, optional email
   - `PATCH /staff/:id` — rename, role change, `active` toggle. **No hard
     delete**: orders reference staff, and POS-02 shows deactivated staff as
     disabled (deactivation reaches devices via the normal delta pull)
   - `POST /staff/:id/pin` — body `{ pin }`, 4–6 digits; stores argon2id hash
     (same OWASP options as passwords); response never echoes the PIN
   - Admin responses **never include `pin_hash` or `password_hash`** — the
     sync projection is the only carrier of `pin_hash`, and only to activated
     devices. A test locks this in.
   - Guardrails: owner cannot deactivate themself; the last active
     staff member with an owner role cannot be deactivated or demoted.
3. **Client-side verify** in `@retailos/domain`: `verifyPin(pin, pinHash)`
   using **hash-wasm** (`argon2Verify` parses the server's encoded string).
   Pure WASM → works in browser (pos-web) and Node/Electron. React Native
   needs a separate adapter — deferred to the mobile phase. Rejected
   alternatives: `argon2-browser` (unmaintained emscripten build), server-side
   verify (breaks offline — non-negotiable). A cross-library test in the API
   suite proves a hash minted by the API's `argon2` package verifies under
   hash-wasm.
4. **PIN policy.** 4–6 digits. Duplicate PINs across staff are allowed —
   unlock is avatar-first, so there is no identify-by-PIN ambiguity.
   Client-side throttle per POS-02: 5 wrong attempts → 30 s cooldown, then 5
   more; never a hard lockout. Attempt counter is per lock-screen session
   (in-memory), not persisted.
5. **pos-web PIN lock.** Real `PinLockScreen` per POS-02, fed by a thin
   provider interface so 1C can swap in the sync engine:
   ```ts
   interface StaffDirectory {
     listStaff(): Promise<Array<{ id: string; name: string; roleId: string; pinHash: string | null; active: boolean }>>;
   }
   ```
   Unlock produces a session `{ staffId, name }` held in App state. **Auto-lock
   after 90 s** of inactivity (FR-5.1) back to the lock screen; app state
   (future cart) is preserved and restored on unlock. Staff with no PIN set
   cannot unlock (avatar disabled with hint). In 1F, pos-web dev mode uses an
   in-memory `StaffDirectory` stub; the sync-backed implementation arrives
   with the 1C Electron wiring.
6. **Attribution.** `LocalSaleInput.staffId` becomes **required** in
   `@retailos/sync` (compile-time + runtime guard in `recordSale`). The server
   DTO stays `nullish`-tolerant so already-queued batches from older clients
   still ingest.
7. **Admin UI: minimal "Settings → Staff" page** (ADM-15 Phase-1 subset —
   recorded as such in `04-design/screen-inventory.md`): staff list with role +
   active badges, add-staff form, rename/role/active editing, "Set PIN" /
   "Reset PIN" action (owner types the new PIN; it is shown only at entry
   time). **Mockup first** per ground rule 3 — HTML mockup added under
   `04-design/mockups/admin--staff.html` and user-approved before any admin
   code.

## Data flow (end to end)

Owner creates cashier + sets PIN in admin → `staff` row bumps `sync_rev` →
device pulls delta (or bootstrap) → `pin_hash` lands in the device mirror →
lock screen lists avatars from mirror → cashier taps avatar, types PIN →
`verifyPin` locally (works offline) → unlock session `{ staffId }` → every
`recordSale` stamps `staffId` → fact syncs up → `orders.staff_id` in Postgres.

## Testing

- **API**: role seeding (signup + backfill), CRUD happy paths, cashier denied
  `staff_edit`, PIN validation (4–6 digits only), self-deactivation and
  last-owner guards, no-hash-leak on every staff response, PIN set bumps
  `sync_rev` (device sees the change), cross-library argon2 ↔ hash-wasm test
- **domain**: `verifyPin` accept/reject, malformed hash → false (not throw)
- **pos-web**: lock-screen state machine (cooldown after 5 misses, disabled
  states, 90 s auto-lock timer, session restore) via component tests
- **E2E** (scripted, real Postgres): admin creates cashier + PIN → device
  bootstrap → verifyPin unlock → sale carries `staff_id` → row in Postgres

## Out of scope (resist!)

Custom roles / permission editor, audit log viewer (FR-5.3), Owner PIN
escalation flow at the register (lands with 1C refund/void/discount UI),
TOTP enforcement, per-store auto-lock timeout setting (Phase 2), RN adapter
for verifyPin, keychain SecretStore (1C).
