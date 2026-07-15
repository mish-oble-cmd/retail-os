'use client';

import { Badge, MoneyText } from '@retailos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { AppShell } from '../../../components/app-shell';
import { shiftsApi, type ShiftDetailResource } from '../../../lib/catalog-api';

/**
 * Shift detail + Z-report (1D, FR-6.2). Renders the stored z_snapshot verbatim —
 * the exact figures the cashier saw at close — plus the cash movements.
 */
export default function ShiftDetailPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = use(params);
  const shift = useQuery({ queryKey: ['shift', shiftId], queryFn: () => shiftsApi.getShift(shiftId) });

  return (
    <AppShell title="Shift">
      <div className="mx-auto max-w-3xl p-8">
        <Link href="/shifts" className="text-body-sm text-ink-muted hover:text-ink">
          ‹ All shifts
        </Link>

        {shift.isLoading && <p className="mt-4 text-body-sm text-ink-muted">Loading…</p>}
        {shift.isError && <p className="mt-4 text-body-sm text-danger">Could not load this shift.</p>}
        {shift.data && <ShiftView shift={shift.data} />}
      </div>
    </AppShell>
  );
}

function ShiftView({ shift }: { shift: ShiftDetailResource }) {
  const c = shift.currency;
  const z = shift.z;
  return (
    <>
      <div className="mb-6 mt-4 flex items-center gap-3">
        <p className="text-h3 font-semibold text-ink">
          {shift.opened_at ? new Date(shift.opened_at).toLocaleString('en-PH') : '—'}
        </p>
        <Badge tone={shift.state === 'open' ? 'warning' : 'neutral'}>{shift.state}</Badge>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <Field label="Opened by" value={shift.opened_by ?? '—'} />
        <Field label="Closed by" value={shift.closed_by ?? '—'} />
        <Field
          label="Opened"
          value={shift.opened_at ? new Date(shift.opened_at).toLocaleString('en-PH') : '—'}
        />
        <Field
          label="Closed"
          value={shift.closed_at ? new Date(shift.closed_at).toLocaleString('en-PH') : '—'}
        />
      </div>

      {/* Cash reconciliation */}
      <Section title="Cash reconciliation">
        <Row label="Opening float" value={<MoneyText amount={shift.opening_float} currency={c} />} />
        {z && (
          <>
            <Row label="Cash sales" value={<MoneyText amount={z.tenders.cash} currency={c} />} />
            {z.cashRefunds > 0 && <Row label="Cash refunds" value={<MoneyText amount={-z.cashRefunds} currency={c} />} />}
            {z.paidIn > 0 && <Row label="Paid in" value={<MoneyText amount={z.paidIn} currency={c} />} />}
            {z.paidOut > 0 && <Row label="Paid out" value={<MoneyText amount={-z.paidOut} currency={c} />} />}
          </>
        )}
        <Row
          strong
          label="Expected in drawer"
          value={shift.closing_expected != null ? <MoneyText amount={shift.closing_expected} currency={c} /> : '—'}
        />
        <Row
          label="Counted (blind)"
          value={shift.closing_counted != null ? <MoneyText amount={shift.closing_counted} currency={c} /> : '—'}
        />
        <Row
          strong
          label="Over / short"
          value={
            shift.over_short == null ? (
              '—'
            ) : shift.over_short === 0 ? (
              <span className="text-ink-muted">Balanced</span>
            ) : (
              <MoneyText
                amount={shift.over_short}
                currency={c}
                className={shift.over_short > 0 ? 'text-success' : 'text-danger'}
              />
            )
          }
        />
      </Section>

      {/* Z-report */}
      {z && (
        <Section title="Z-report">
          <Row label="Gross sales" value={<MoneyText amount={z.grossSales} currency={c} />} />
          <Row label="Net sales" value={<MoneyText amount={z.netSales} currency={c} />} />
          <Row label="Tax collected" value={<MoneyText amount={z.taxCollected} currency={c} />} />
          <Row label="Discounts" value={<MoneyText amount={z.discounts} currency={c} />} />
          <Row label="Refunds" value={<MoneyText amount={z.refunds} currency={c} />} />
          <Row label="Transactions" value={<span className="text-ink">{z.txnCount}</span>} />
          <Row label="Cash tenders" value={<MoneyText amount={z.tenders.cash} currency={c} />} />
          <Row label="Card tenders" value={<MoneyText amount={z.tenders.card_manual} currency={c} />} />
          {z.byStaff.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="mb-1 text-caption uppercase tracking-wide text-ink-muted">By staff</p>
              {z.byStaff.map((s) => (
                <Row
                  key={s.staffId}
                  label={`${s.staffId} · ${s.txnCount} txn`}
                  value={<MoneyText amount={s.netSales} currency={c} />}
                />
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Cash movements */}
      {shift.movements.length > 0 && (
        <Section title="Cash movements">
          {shift.movements.map((m) => (
            <Row
              key={m.id}
              label={`${labelKind(m.kind)}${m.reason ? ` — ${m.reason}` : ''}`}
              value={
                m.kind === 'no_sale' ? (
                  <span className="text-ink-muted">drawer</span>
                ) : (
                  <MoneyText amount={m.kind === 'paid_out' ? -m.amount : m.amount} currency={c} />
                )
              }
            />
          ))}
        </Section>
      )}
    </>
  );
}

function labelKind(kind: 'paid_in' | 'paid_out' | 'no_sale'): string {
  return kind === 'paid_in' ? 'Paid in' : kind === 'paid_out' ? 'Paid out' : 'No sale';
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-card border border-border bg-surface p-5">
      <p className="mb-3 text-caption font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
      <div className="text-body-sm">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <p className="text-caption uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="text-body text-ink">{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={'flex justify-between py-1.5 ' + (strong ? 'border-t border-border pt-2 font-semibold text-ink' : 'text-ink-muted')}>
      <span>{label}</span>
      <span className={strong ? 'font-money text-ink' : 'font-money text-ink'}>{value}</span>
    </div>
  );
}
