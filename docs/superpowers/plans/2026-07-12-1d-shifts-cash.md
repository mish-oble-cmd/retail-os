# 1D Shifts & cash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the offline-first cash-drawer lifecycle (open with float → paid in/out & no-sale → blind close → over/short → printable Z-report) on `pos-web`, synced to the server under RLS, with a minimal Admin read view.

**Architecture:** Mirrors the 1C sell flow exactly — a device-local entity (`shifts`, `cash_movements`) written through `@retailos/sync`, three new append-style outbox facts (`shift.opened`, `cash.movement`, `shift.closed`), server ingest in the existing `/sync/batches` pipeline under Postgres RLS (migration `0006`), pure integer math in `@retailos/domain`, and React screens gated into the existing `App.tsx` state machine. Every order is stamped with `shift_id`; the Z-report is computed on-device at close so it prints offline and is stored verbatim server-side.

**Tech Stack:** TypeScript strict · `@retailos/domain` (pure) · `@retailos/sync` (SqlDriver over sql.js/better-sqlite3) · NestJS + Drizzle + Postgres + zod · Vite/React `pos-web` · Next.js `admin` · Vitest.

## Global Constraints

- **Money is integers** — all amounts in minor units (centavos), never floats.
- **Multi-tenant** — every server table carries `store_id`; RLS `USING (store_id = current_setting('app.store_id')::uuid)`; grants to `retailos_app`.
- **Offline-first** — open / sell / paid-in-out / close / print-Z must all work with no network; facts sync later via the outbox.
- **TypeScript strict** — no `any` without a `// why:` comment.
- **ULIDs** — Crockford base32, regex `^[0-9A-HJKMNP-TV-Z]{26}$`.
- **Device DDL is split on `;`** — comments inside `packages/sync/src/schema.ts` DDL must NOT contain a semicolon.
- **Commits** — `type(scope): summary (1D)` + `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Permissions (FR-5.2)** — Cashier: open/close own shift, paid in/out. Owner PIN: over/short reveal at close, no-sale drawer open.

---

### Task 1: Domain cash primitives

**Files:**
- Create: `packages/domain/src/shift/cash.ts`
- Create: `packages/domain/src/shift/zreport.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/cash.test.ts`, `packages/domain/test/zreport.test.ts`

**Interfaces:**
- Produces:
  - `calculateExpectedCash(input: { openingFloat: number; cashSales: number; cashRefunds: number; paidIn: number; paidOut: number }): number`
  - `calculateOverShort(counted: number, expected: number): number`
  - `buildZReport(input: ZReportInput): ZSnapshot`
  - Types `ZReportInput`, `ZSnapshot`, `ZReportOrder`, `ZReportRefund`, `ZReportMovement`.

`ZSnapshot` fields (all integer minor units): `grossSales, netSales, taxCollected, discounts, refunds, txnCount, tenders: { cash: number; card_manual: number }, cashRefunds, byStaff: Array<{ staffId: string; netSales: number; txnCount: number }>, openingFloat, paidIn, paidOut, expectedCash, countedCash, overShort`.

`ZReportInput`: `{ orders: ZReportOrder[]; refunds: ZReportRefund[]; movements: ZReportMovement[]; openingFloat: number; countedCash: number }`.
- `ZReportOrder`: `{ staffId: string | null; subtotal: number; discount: number; tax: number; total: number; payments: Array<{ tender: 'cash' | 'card_manual'; amount: number }> }`
- `ZReportRefund`: `{ tender: 'cash' | 'card_manual'; amount: number }`
- `ZReportMovement`: `{ kind: 'paid_in' | 'paid_out' | 'no_sale'; amount: number }`

- [ ] **Step 1: Write failing tests for cash math**

```ts
// packages/domain/test/cash.test.ts
import { describe, it, expect } from 'vitest';
import { calculateExpectedCash, calculateOverShort } from '../src/index.js';

describe('calculateExpectedCash', () => {
  it('sums float + cash sales − cash refunds + paid in − paid out', () => {
    expect(
      calculateExpectedCash({ openingFloat: 200000, cashSales: 1854000, cashRefunds: 16500, paidIn: 0, paidOut: 50000 }),
    ).toBe(1987500); // 2000 + 18540 − 165 − 500 = 19875 (mockup figures)
  });
  it('handles an empty drawer beyond float', () => {
    expect(calculateExpectedCash({ openingFloat: 500000, cashSales: 0, cashRefunds: 0, paidIn: 0, paidOut: 0 })).toBe(500000);
  });
});

describe('calculateOverShort', () => {
  it('is negative when short', () => {
    expect(calculateOverShort(1975500, 1987500)).toBe(-12000); // −₱120.00
  });
  it('is positive when over and zero when exact', () => {
    expect(calculateOverShort(1990000, 1987500)).toBe(2500);
    expect(calculateOverShort(1987500, 1987500)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @retailos/domain test cash` → FAIL (not exported).

- [ ] **Step 3: Implement `cash.ts`**

```ts
// packages/domain/src/shift/cash.ts
export interface ExpectedCashInput {
  openingFloat: number;
  cashSales: number;
  cashRefunds: number;
  paidIn: number;
  paidOut: number;
}

/** Expected cash in the drawer at close (minor units). */
export function calculateExpectedCash(i: ExpectedCashInput): number {
  return i.openingFloat + i.cashSales - i.cashRefunds + i.paidIn - i.paidOut;
}

/** Signed over/short: positive = over, negative = short (minor units). */
export function calculateOverShort(counted: number, expected: number): number {
  return counted - expected;
}
```

- [ ] **Step 4: Write failing test for `buildZReport`**

```ts
// packages/domain/test/zreport.test.ts
import { describe, it, expect } from 'vitest';
import { buildZReport } from '../src/index.js';

const order = (staffId: string, tender: 'cash' | 'card_manual', total: number, tax = 0, discount = 0) => ({
  staffId, subtotal: total - tax, discount, tax, total, payments: [{ tender, amount: total }],
});

describe('buildZReport', () => {
  it('aggregates gross/net/tax/discounts/tenders/per-staff and reconciles cash', () => {
    const z = buildZReport({
      orders: [order('ana', 'cash', 1000, 100, 0), order('ben', 'card_manual', 2000, 200, 0), order('ana', 'cash', 500, 50, 50)],
      refunds: [{ tender: 'cash', amount: 165 }],
      movements: [{ kind: 'paid_out', amount: 500 }, { kind: 'paid_in', amount: 0 }, { kind: 'no_sale', amount: 0 }],
      openingFloat: 200000, countedCash: 200000 + 1000 + 500 - 165 - 500,
    });
    expect(z.grossSales).toBe(3500);
    expect(z.taxCollected).toBe(350);
    expect(z.netSales).toBe(3150);
    expect(z.discounts).toBe(50);
    expect(z.refunds).toBe(165);
    expect(z.txnCount).toBe(3);
    expect(z.tenders).toEqual({ cash: 1500, card_manual: 2000 });
    expect(z.cashRefunds).toBe(165);
    expect(z.paidOut).toBe(500);
    expect(z.byStaff).toEqual([
      { staffId: 'ana', netSales: 1350, txnCount: 2 },
      { staffId: 'ben', netSales: 1800, txnCount: 1 },
    ]);
    expect(z.expectedCash).toBe(200835); // 200000 + 1500 − 165 − 500
    expect(z.overShort).toBe(0);
  });
});
```

- [ ] **Step 5: Run to verify failure** — `pnpm --filter @retailos/domain test zreport` → FAIL.

- [ ] **Step 6: Implement `zreport.ts`** (net = total − tax; per-staff insertion-ordered; cash sales = sum of cash payments; reuse `calculateExpectedCash`/`calculateOverShort`).

```ts
// packages/domain/src/shift/zreport.ts
import { calculateExpectedCash, calculateOverShort } from './cash.js';

export interface ZReportOrder {
  staffId: string | null;
  subtotal: number; discount: number; tax: number; total: number;
  payments: Array<{ tender: 'cash' | 'card_manual'; amount: number }>;
}
export interface ZReportRefund { tender: 'cash' | 'card_manual'; amount: number }
export interface ZReportMovement { kind: 'paid_in' | 'paid_out' | 'no_sale'; amount: number }
export interface ZReportInput {
  orders: ZReportOrder[]; refunds: ZReportRefund[]; movements: ZReportMovement[];
  openingFloat: number; countedCash: number;
}
export interface ZSnapshot {
  grossSales: number; netSales: number; taxCollected: number; discounts: number; refunds: number;
  txnCount: number; tenders: { cash: number; card_manual: number }; cashRefunds: number;
  byStaff: Array<{ staffId: string; netSales: number; txnCount: number }>;
  openingFloat: number; paidIn: number; paidOut: number;
  expectedCash: number; countedCash: number; overShort: number;
}

export function buildZReport(input: ZReportInput): ZSnapshot {
  const tenders = { cash: 0, card_manual: 0 };
  let grossSales = 0, taxCollected = 0, discounts = 0;
  const staffOrder: string[] = [];
  const staffAgg = new Map<string, { netSales: number; txnCount: number }>();
  for (const o of input.orders) {
    grossSales += o.total; taxCollected += o.tax; discounts += o.discount;
    for (const p of o.payments) tenders[p.tender] += p.amount;
    const key = o.staffId ?? 'unattributed';
    if (!staffAgg.has(key)) { staffAgg.set(key, { netSales: 0, txnCount: 0 }); staffOrder.push(key); }
    const agg = staffAgg.get(key)!;
    agg.netSales += o.total - o.tax; agg.txnCount += 1;
  }
  const netSales = grossSales - taxCollected;
  const cashRefunds = input.refunds.filter((r) => r.tender === 'cash').reduce((s, r) => s + r.amount, 0);
  const refunds = input.refunds.reduce((s, r) => s + r.amount, 0);
  const paidIn = input.movements.filter((m) => m.kind === 'paid_in').reduce((s, m) => s + m.amount, 0);
  const paidOut = input.movements.filter((m) => m.kind === 'paid_out').reduce((s, m) => s + m.amount, 0);
  const expectedCash = calculateExpectedCash({ openingFloat: input.openingFloat, cashSales: tenders.cash, cashRefunds, paidIn, paidOut });
  return {
    grossSales, netSales, taxCollected, discounts, refunds, txnCount: input.orders.length,
    tenders, cashRefunds,
    byStaff: staffOrder.map((k) => ({ staffId: k, ...staffAgg.get(k)! })),
    openingFloat: input.openingFloat, paidIn, paidOut,
    expectedCash, countedCash: input.countedCash, overShort: calculateOverShort(input.countedCash, expectedCash),
  };
}
```

- [ ] **Step 7: Export from index** — add to `packages/domain/src/index.ts`:

```ts
export * from './shift/cash.js';
export * from './shift/zreport.js';
```

- [ ] **Step 8: Run both suites** — `pnpm --filter @retailos/domain test` → PASS.

- [ ] **Step 9: Build the package** so `@retailos/sync`/pos-web see fresh dist types — `pnpm --filter @retailos/domain build`.

- [ ] **Step 10: Commit**

```bash
git add packages/domain/src/shift packages/domain/src/index.ts packages/domain/test/cash.test.ts packages/domain/test/zreport.test.ts packages/domain/dist
git commit -m "feat(domain): shift cash + Z-report primitives (1D)"
```

---

### Task 2: Device layer — shifts, cash movements, order stamping, facts

**Files:**
- Modify: `packages/sync/src/schema.ts` (bump `DEVICE_SCHEMA_VERSION` 2→3; add `shifts`, `cash_movements`; add `shift_id` to `orders`)
- Create: `packages/sync/src/shifts.ts` (open/close/paid-in-out/no-sale + queries)
- Modify: `packages/sync/src/outbox.ts` (`shift_id` on order insert + payload; new fact types in `toFact`)
- Modify: `packages/sync/src/http.ts` (facts union)
- Modify: `packages/sync/src/client.ts` (SyncClient methods)
- Modify: `packages/sync/src/queries.ts` (Z-report source rows for a shift)
- Test: `packages/sync/test/shifts.test.ts`, update `packages/sync/test/schema.test.ts`, `packages/sync/test/outbox.test.ts`

**Interfaces:**
- Consumes: `SqlDriver` (from `./driver`), `buildZReport`/`ZSnapshot` (from `@retailos/domain`).
- Produces (from `shifts.ts`):
  - `openShift(driver, input: OpenShiftInput): void` — `OpenShiftInput = { id; registerId; locationId; openedByStaffId; openingFloat; clientCreatedAt; localSeq }`
  - `recordCashMovement(driver, input: CashMovementInput): void` — `CashMovementInput = { id; shiftId; kind: 'paid_in'|'paid_out'|'no_sale'; amount; reason; staffId; approvedByStaffId?; clientCreatedAt }`
  - `closeShift(driver, input: CloseShiftInput): void` — `CloseShiftInput = { id; closedByStaffId; closedAt; closingCounted; closingExpected; overShort; z: ZSnapshot }`
  - `getActiveShift(driver, registerId): ActiveShift | null`
  - `getShiftZSource(driver, shiftId): { orders: ZReportOrder[]; refunds: ZReportRefund[]; movements: ZReportMovement[]; openingFloat: number }`
- Produces (from `outbox.ts`): `LocalSaleInput` gains optional `shiftId?: string | null`.

- [ ] **Step 1: Bump schema + add tables.** In `packages/sync/src/schema.ts` set `export const DEVICE_SCHEMA_VERSION = 3;`. Add `shift_id TEXT` to the `orders` CREATE TABLE (after `staff_id`). Append (no `;` inside comments):

```sql
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  register_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  opened_by_staff_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opening_float INTEGER NOT NULL,
  closed_by_staff_id TEXT,
  closed_at TEXT,
  closing_counted INTEGER,
  closing_expected INTEGER,
  over_short INTEGER,
  z_snapshot TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  local_seq INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_register ON shifts (register_id) WHERE state = 'open';
CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL,
  approved_by_staff_id TEXT,
  client_created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cash_movements_shift_idx ON cash_movements (shift_id);
```

- [ ] **Step 2: Update schema test.** In `packages/sync/test/schema.test.ts` assert `DEVICE_SCHEMA_VERSION === 3` and that a fresh migrate creates `shifts` + `cash_movements` (query `sqlite_master`). Run `pnpm --filter @retailos/sync test schema` → expect PASS after implementing.

- [ ] **Step 3: Write failing lifecycle test.**

```ts
// packages/sync/test/shifts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDriver } from '../src/testing.js'; // existing test helper; else openSqlJsDriver
import { migrate } from '../src/schema.js';
import { openShift, recordCashMovement, closeShift, getActiveShift, getShiftZSource } from '../src/shifts.js';

let driver: any;
beforeEach(() => { driver = openMemoryDriver(); migrate(driver); });

it('opens one shift and rejects a second open on the same register', () => {
  openShift(driver, { id: 'S1', registerId: 'R1', locationId: 'L1', openedByStaffId: 'ana', openingFloat: 200000, clientCreatedAt: 't0', localSeq: 1 });
  expect(getActiveShift(driver, 'R1')?.id).toBe('S1');
  expect(() => openShift(driver, { id: 'S2', registerId: 'R1', locationId: 'L1', openedByStaffId: 'ben', openingFloat: 100000, clientCreatedAt: 't1', localSeq: 2 })).toThrow();
});

it('records movements and closes with a Z snapshot, emitting facts', () => {
  openShift(driver, { id: 'S1', registerId: 'R1', locationId: 'L1', openedByStaffId: 'ana', openingFloat: 200000, clientCreatedAt: 't0', localSeq: 1 });
  recordCashMovement(driver, { id: 'M1', shiftId: 'S1', kind: 'paid_out', amount: 500, reason: 'LPG COD', staffId: 'ana', clientCreatedAt: 't1' });
  closeShift(driver, { id: 'S1', closedByStaffId: 'ana', closedAt: 't9', closingCounted: 199500, closingExpected: 199500, overShort: 0, z: { grossSales: 0 } as any });
  expect(getActiveShift(driver, 'R1')).toBeNull();
  const facts = driver.all(`SELECT fact_type FROM outbox ORDER BY seq`).map((r: any) => r.fact_type);
  expect(facts).toEqual(['shift.opened', 'cash.movement', 'shift.closed']);
});
```

Run `pnpm --filter @retailos/sync test shifts` → FAIL (module missing).

- [ ] **Step 4: Implement `shifts.ts`.** Each mutation runs in `driver.tx(...)`, writes its row, then inserts an outbox fact (fact_type + entity_id + JSON payload) exactly like `recordRefund`. `openShift` relies on the partial-unique index to throw on a second open. `closeShift` updates the row (`state='closed'`, counted/expected/over_short/z_snapshot) and inserts the `shift.closed` fact carrying `z`. `getActiveShift` = `SELECT ... WHERE register_id=? AND state='open'`. `getShiftZSource` joins `orders`/`payments`/`refunds`/`refund payments`/`cash_movements` filtered by `shift_id` and returns rows shaped for `buildZReport` (map DB rows → `ZReportOrder` etc.; cash refunds come from refund rows whose original payment tender was cash — Phase 1 refunds are cash-only per 1C, so treat refund amount as `tender:'cash'`).

Outbox insert helper (match existing `recordRefund` insert columns — inspect `outbox.ts` for the exact `INSERT INTO outbox (...)` shape and reuse it).

- [ ] **Step 5: Add fact types to the wire union.** In `packages/sync/src/http.ts` extend `facts`:

```ts
    | { type: 'shift.opened'; shift: Row }
    | { type: 'cash.movement'; movement: Row }
    | { type: 'shift.closed'; shift: Row }
```

In `packages/sync/src/outbox.ts` `toFact`, add cases before `default`:

```ts
    case 'shift.opened':
      return { type: 'shift.opened', shift: payload };
    case 'cash.movement':
      return { type: 'cash.movement', movement: payload };
    case 'shift.closed':
      return { type: 'shift.closed', shift: payload };
```

- [ ] **Step 6: Stamp `shift_id` on sales.** In `outbox.ts`: add `shiftId?: string | null` to `LocalSaleInput`; add `shift_id` to the `INSERT INTO orders (...)` column list + `VALUES` (bind `sale.shiftId ?? null`); add `shift_id: sale.shiftId ?? null` to `orderFactPayload`.

- [ ] **Step 7: Update `outbox.test.ts`** — add an assertion that a `recordSale` with `shiftId` writes `orders.shift_id` and includes `shift_id` in the emitted `order.completed` payload. Run `pnpm --filter @retailos/sync test outbox` → PASS.

- [ ] **Step 8: SyncClient methods.** In `packages/sync/src/client.ts` add thin delegators `openShift`, `recordCashMovement`, `closeShift`, `getActiveShift`, `getShiftZSource` forwarding to `shifts.ts` with `this.driver`.

- [ ] **Step 9: Full sync suite** — `pnpm --filter @retailos/sync test` → PASS.

- [ ] **Step 10: Build the package** — `pnpm --filter @retailos/sync build`.

- [ ] **Step 11: Commit**

```bash
git add packages/sync/src packages/sync/test packages/sync/dist
git commit -m "feat(sync): device shifts + cash movements + shift facts, order shift_id (1D)"
```

---

### Task 3: Server ingest — migration 0006 + fact handlers

**Files:**
- Create: `apps/api/src/db/migrations/0006_shifts.sql`
- Modify: `apps/api/src/db/schema.ts` (add `shifts`, `cashMovements`; add `shiftId` to `orders`)
- Modify: `apps/api/src/modules/sync/dto.ts` (3 fact schemas + union + types)
- Modify: `apps/api/src/modules/sync/sync.service.ts` (3 ingest handlers + dispatch; `shiftId` on order insert)
- Test: `apps/api/test/shift-ingest.service.test.ts`

**Interfaces:**
- Consumes: `SyncFact` discriminated union (dto.ts), `ctx` (`storeId`, `registerId`, `locationId`).
- Produces: server rows in `shifts` / `cash_movements`; `orders.shift_id` populated from the fact.

- [ ] **Step 1: Write migration `0006_shifts.sql`** — `shifts` and `cash_movements` tables (tenant PK `(store_id, id)`), composite tenant FKs to `registers`/`staff`, `orders ADD COLUMN shift_id text`, enable RLS + policy, GRANTs to `retailos_app` (shifts: INSERT + UPDATE; cash_movements: INSERT). Follow `0005_refunds.sql` verbatim for the RLS/policy/grant idiom.

- [ ] **Step 2: Drizzle defs** — mirror the migration in `schema.ts` (`shifts`, `cashMovements` pgTables with `unique(store_id,id)`, register/staff FKs; add `shiftId: text('shift_id')` to `orders`).

- [ ] **Step 3: Apply migration** to the dev DB — `cd apps/api && DATABASE_URL='postgres://retailos:retailos@localhost:5433/retailos' pnpm db:migrate` (or the project's migrate script). Expected: `0006` applied.

- [ ] **Step 4: Write failing PGlite ingest test** (`apps/api/test/shift-ingest.service.test.ts`) — seed a store+register+staff+device ctx; push `shift.opened` → assert a `shifts` row `state='open'`; push a completed order fact carrying `shiftId` → assert `orders.shift_id` set; push `cash.movement` (paid_out) → assert row; push `shift.closed` with a Z snapshot + counted/expected/over_short → assert row updated to `closed` with `z_snapshot` JSON + `over_short`; push `shift.closed` for a missing shift → assert the batch rejects (throws / rolls back). Model it on `apps/api/test/receipt.service.test.ts` + the refund ingest test. Run → FAIL.

- [ ] **Step 5: Add zod fact schemas** in `dto.ts` — `shiftOpenedFactSchema` (`type: 'shift.opened'`, `shift: {...}`), `cashMovementFactSchema`, `shiftClosedFactSchema` (with a nested `z` object schema); add all three to the `discriminatedUnion`; export `ShiftOpenedFact`/`CashMovementFact`/`ShiftClosedFact` types. Add optional `shiftId` to the order fact schema.

- [ ] **Step 6: Implement handlers** in `sync.service.ts` — `ingestShiftOpened`, `ingestCashMovement`, `ingestShiftClosed`; wire them into the `switch (fact.type)` dispatch in the batch loop; add `shiftId: fact.order.shiftId ?? null` to the `tx.insert(orders).values({...})`. `ingestShiftClosed` does `tx.update(shifts).set({...}).where(store+id)`; if 0 rows updated, `throw` to roll the batch back (close-before-open retry posture, same as refund→order).

- [ ] **Step 7: Run** — `pnpm --filter @retailos/api test shift-ingest` → PASS. Then full API suite `pnpm --filter @retailos/api test` → PASS.

- [ ] **Step 8: Regenerate OpenAPI** if the repo commits a generated spec (check `apps/api` for an openapi script; run it if present).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/db apps/api/src/modules/sync apps/api/test/shift-ingest.service.test.ts
git commit -m "feat(api): shift + cash-movement ingest, migration 0006, order shift_id (1D)"
```

---

### Task 4: pos-web open-shift screen + Sell gate

**Files:**
- Create: `apps/pos-web/src/screens/ShiftOpenScreen.tsx`
- Create: `apps/pos-web/src/lib/shift.ts` (device-facing helpers: `useActiveShift`, ulid, cash formatting reuse)
- Modify: `apps/pos-web/src/App.tsx` (add `'shift-open'`/`'shift-close'` to `Screen`; bootstrap gate; stamp `shiftId` when building sales)
- Modify: `apps/pos-web/src/lib/sale.ts` (thread `shiftId` into `LocalSaleInput`)
- Test: browser verification (Task 8) — no unit harness for screens in this app (matches 1C).

**Interfaces:**
- Consumes: `openShift`, `getActiveShift` (SyncClient/`shifts.ts`).
- Produces: `App` guarantees `activeShift` is non-null before mounting `SellScreen`; `buildSaleInput` receives `shiftId`.

- [ ] **Step 1:** Add `'shift-open' | 'shift-close'` to the `Screen` union in `App.tsx`. After PIN login, call `getActiveShift(driver, registerId)`; store in state. If null → `setScreen('shift-open')` and do not allow `'sell'`.

- [ ] **Step 2: Build `ShiftOpenScreen`** from the POS-10 open mockup: topbar (Open shift · register/location/time), float `amount-display`, denomination chips `+1000 +500 +100 +50 +20 +10` that accumulate into the running float, a 3-col NumberPad (`1..9`, `00`, `0`, `⌫`) that edits the total, and "Open shift with ₱X". On submit: generate a ULID, call `openShift(...)`, set `activeShift`, `setScreen('sell')`. Reuse the money formatting util from the sell flow (`lib/` — check `cart.ts`/`sale.ts` for the existing formatter).

- [ ] **Step 3: Thread `shiftId`.** In `App.tsx` where the completed sale is built (the Payment `onComplete`), pass `activeShift.id`; in `lib/sale.ts` `buildSaleInput`, add `shiftId` to the returned `LocalSaleInput`.

- [ ] **Step 4: Header affordance.** Add a small shift indicator + "Close shift" button to the Sell header (next to park/orders), routing to `'shift-close'`.

- [ ] **Step 5: Typecheck** — `pnpm --filter @retailos/pos-web typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos-web/src/screens/ShiftOpenScreen.tsx apps/pos-web/src/lib/shift.ts apps/pos-web/src/App.tsx apps/pos-web/src/lib/sale.ts
git commit -m "feat(pos-web): POS-10 open shift + Sell gate + order shift stamping (1D)"
```

---

### Task 5: pos-web paid-in/out + no-sale (Owner PIN)

**Files:**
- Create: `apps/pos-web/src/screens/CashMovementSheet.tsx`
- Modify: `apps/pos-web/src/App.tsx` (wire the sheet + no-sale escalation)
- Reuse: `apps/pos-web/src/lib/escalation.ts` (`verifyOwnerPin`)

**Interfaces:**
- Consumes: `recordCashMovement`, `verifyOwnerPin`, `activeShift`.

- [ ] **Step 1: Build `CashMovementSheet`** — segmented control Paid in / Paid out; amount NumberPad + `amount-display`; required reason text field; confirm writes `recordCashMovement({ kind, amount, reason, staffId, shiftId })`. Block confirm when amount ≤ 0 or reason empty (paid_in/out).

- [ ] **Step 2: No-sale path** — a "No sale (open drawer)" action requires Owner PIN via the existing escalation modal; on approval, `recordCashMovement({ kind: 'no_sale', amount: 0, reason: 'No sale', staffId, approvedByStaffId, shiftId })`.

- [ ] **Step 3: Wire into the Sell header** (a "Cash" / drawer menu). Typecheck → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pos-web/src/screens/CashMovementSheet.tsx apps/pos-web/src/App.tsx
git commit -m "feat(pos-web): paid in/out + no-sale drawer (Owner PIN) (1D)"
```

---

### Task 6: pos-web close-shift + over/short + Z-report print

**Files:**
- Create: `apps/pos-web/src/screens/ShiftCloseScreen.tsx`
- Modify: `apps/pos-web/src/App.tsx` (wire close → sell after close)
- Modify: `apps/pos-web/src/styles.css` (Z-report `@media print` block if the receipt block isn't reusable as-is)

**Interfaces:**
- Consumes: `getShiftZSource`, `buildZReport` (`@retailos/domain`), `closeShift`, `verifyOwnerPin`, `isOwner`.

- [ ] **Step 1: Build `ShiftCloseScreen`** per the POS-10 close mockup. On mount, load `getShiftZSource(shiftId)`. Blind count entry (NumberPad + `amount-display`) — the expected figure and reconciliation rows stay hidden until the count is submitted. On submit: compute `z = buildZReport({ ...source, countedCash })`; show the reconciliation rows (opening float, cash sales, cash refunds, paid in/out, expected, counted). The **over/short reveal is Owner-gated**: if the closer `isOwner` (or an Owner approves via `verifyOwnerPin`), show the signed `overShort` in the red/green reveal box; otherwise show "Recorded — see your manager" with the number hidden.

- [ ] **Step 2: Close + print.** "Close shift & print Z-report" calls `closeShift({ id, closedByStaffId, closedAt, closingCounted, closingExpected: z.expectedCash, overShort: z.overShort, z })`, then a printable Z panel (`.print-receipt`-style) and `window.print()`; then clear `activeShift` and route to `'shift-open'` (next shift) or PIN lock.

- [ ] **Step 3: Print CSS** — ensure a `@media print` rule renders the Z panel and hides `.no-print` chrome (reuse the 1C receipt print classes; add a Z-specific container if needed).

- [ ] **Step 4: Typecheck** — `pnpm --filter @retailos/pos-web typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos-web/src/screens/ShiftCloseScreen.tsx apps/pos-web/src/App.tsx apps/pos-web/src/styles.css
git commit -m "feat(pos-web): POS-10 close shift + over/short + Z-report print (1D)"
```

---

### Task 7: Admin shifts list + Z detail (read-only)

**Files:**
- Create: `apps/admin/src/app/shifts/page.tsx` (list) + `apps/admin/src/app/shifts/[shiftId]/page.tsx` (detail)
- Create/Modify: admin API route or data fetch for shifts (follow the existing orders-list data pattern in `apps/admin`)
- Modify: `apps/api` — add a read endpoint `GET /shifts` + `GET /shifts/:id` (RLS read) if admin reads via the API (check how the admin orders list fetches; mirror it)

**Interfaces:**
- Consumes: server `shifts` + `cash_movements` rows.

- [ ] **Step 1: Inspect** how the admin orders list is fetched (endpoint + client). Mirror that exactly for shifts. If admin reads directly via an API module, add a minimal `ShiftsController` (`GET /shifts`, `GET /shifts/:id` returning the shift + its cash movements + z_snapshot) guarded like the orders read.

- [ ] **Step 2: Shifts list page** — table: opened_at, register, opened_by, state, over/short (if present), gross (from z_snapshot). Link rows to the detail page.

- [ ] **Step 3: Z detail page** — render the stored `z_snapshot` (gross/net/tax/discounts/refunds/tenders/per-staff/over-short) + the cash movements list.

- [ ] **Step 4: Typecheck both apps** — `pnpm --filter @retailos/admin typecheck` (+ api if changed) → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/app/shifts apps/api/src/modules
git commit -m "feat(admin): read-only shifts list + Z-report detail (1D)"
```

---

### Task 8: E2E + full-repo gate + docs close-out

**Files:**
- Create: `.superpowers/sdd/1d-e2e.mjs` (gitignored), `.superpowers/sdd/1d-report.md` (gitignored)
- Modify: `05-roadmap/phase-1-core-pos-mvp.md` (§1D complete summary; tick the "Close shift" acceptance line)

- [ ] **Step 1: Full-repo gate** — `pnpm turbo typecheck lint test`. Expected: all tasks pass (domain/sync/api/pos-web/admin). Fix any fallout (stale dist types → rebuild the changed packages; unused imports → remove).

- [ ] **Step 2: Browser-verify** each pos-web screen against the real sql.js/OPFS device store, per the preview verification workflow: open shift (float count + chips) → Sell gated until open → a cash + a card sale → paid out with reason → no-sale (Owner PIN) → close: blind count → expected reconciliation → over/short reveal (Owner) → Z panel prints. Capture a screenshot of the over/short reveal + Z panel.

- [ ] **Step 3: Live E2E** (`.superpowers/sdd/1d-e2e.mjs`, adapted from `1c-e2e.mjs`): bring up colima+Postgres if down; seed store/register/staff; device activate; push `shift.opened` → assert `shifts` row; push order facts (cash+card) carrying `shiftId` → assert `orders.shift_id`; push `cash.movement` paid_out; push `shift.closed` with a Z snapshot + counted≠expected → assert `over_short` and `z_snapshot` in Postgres; idempotent replay (no double-apply). Target: all assertions PASS.

- [ ] **Step 4: Write `.superpowers/sdd/1d-report.md`** close-out (what shipped T1–T8, verification results, any env notes).

- [ ] **Step 5: Update roadmap** — add "### 1D Shifts & cash — ✅ complete YYYY-MM-DD" with the shipped summary + E2E result; tick `- [x] Close shift: blind count, over/short shown, Z-report prints`.

- [ ] **Step 6: Commit**

```bash
git add 05-roadmap/phase-1-core-pos-mvp.md
git commit -m "docs(roadmap): 1D Shifts & cash complete (1D)"
```

- [ ] **Step 7: Push** to `phase-1/sell-flow` (updates the open PR #2) — `git push`.

---

## Self-review notes

- **Spec coverage:** open/float (T4), one-open-per-register (T2 index), paid in/out + no-sale (T5), blind close + over/short + Owner gate (T6), Z-report FR-6.2 fields (T1 `ZSnapshot` + T6 render + T7 admin), offline (device-first throughout), 3 facts + ingest (T2/T3), order↔shift stamping (T2/T3/T4), permissions (T5/T6), Admin visibility (T7), tests + E2E (T1–T3, T8). All covered.
- **Type consistency:** `ZSnapshot` field names are used identically in T1 (definition), T6 (`z.expectedCash`, `z.overShort`), T7 (render). Fact type strings `shift.opened`/`cash.movement`/`shift.closed` match across `outbox.ts`/`http.ts`/`dto.ts`/`sync.service.ts`.
- **Known unknowns resolved at execution:** exact `INSERT INTO outbox` column shape (read from `recordRefund`), the admin orders-list fetch pattern (read in T7 step 1), the domain money formatter location in pos-web (read in T4 step 2), and whether the repo commits generated OpenAPI (T3 step 8). Each is a "read the existing code, then mirror it" step, not a placeholder.
