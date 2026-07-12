'use client';

import { Badge, MoneyText } from '@retailos/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { shiftsApi, type ShiftSummaryResource } from '../../lib/catalog-api';

/**
 * Shifts list (1D, FR-6.2). Read-only: each row is a shift with its over/short
 * and gross from the stored Z snapshot. Writes arrive via POS sync facts.
 */
export default function ShiftsPage() {
  const shifts = useQuery({ queryKey: ['shifts'], queryFn: shiftsApi.listShifts });

  return (
    <AppShell title="Shifts">
      <div className="mx-auto max-w-5xl p-8">
        <p className="mb-6 text-body-sm text-ink-muted">
          Cash-drawer sessions per register. Over/short and the Z-report are recorded at close.
        </p>

        {shifts.isLoading && <p className="text-body-sm text-ink-muted">Loading…</p>}
        {shifts.isError && (
          <p className="text-body-sm text-danger">Could not load shifts. Try again.</p>
        )}

        {shifts.data && shifts.data.items.length === 0 && (
          <div className="rounded-card border border-border bg-surface p-8 text-center text-body-sm text-ink-muted">
            No shifts yet. They appear here once a register opens and closes a drawer.
          </div>
        )}

        {shifts.data && shifts.data.items.length > 0 && (
          <div className="overflow-hidden rounded-card border border-border bg-surface">
            <table className="w-full text-body-sm">
              <thead className="border-b border-border bg-bg text-caption uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Opened</th>
                  <th className="px-4 py-3 text-left">Opened by</th>
                  <th className="px-4 py-3 text-left">State</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Over / short</th>
                </tr>
              </thead>
              <tbody>
                {shifts.data.items.map((s) => (
                  <ShiftRow key={s.id} shift={s} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ShiftRow({ shift }: { shift: ShiftSummaryResource }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-bg">
      <td className="px-4 py-3">
        <Link href={`/shifts/${shift.id}`} className="font-medium text-primary hover:underline">
          {shift.opened_at ? new Date(shift.opened_at).toLocaleString('en-PH') : '—'}
        </Link>
      </td>
      <td className="px-4 py-3 text-ink">{shift.opened_by ?? '—'}</td>
      <td className="px-4 py-3">
        <Badge tone={shift.state === 'open' ? 'warning' : 'neutral'}>{shift.state}</Badge>
      </td>
      <td className="px-4 py-3 text-right font-money text-ink">
        {shift.gross_sales != null ? (
          <MoneyText amount={shift.gross_sales} currency={shift.currency} />
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3 text-right font-money">
        <OverShort amount={shift.over_short} currency={shift.currency} />
      </td>
    </tr>
  );
}

function OverShort({ amount, currency }: { amount: number | null; currency: string }) {
  if (amount == null) return <span className="text-ink-muted">—</span>;
  if (amount === 0) return <span className="text-ink-muted">Balanced</span>;
  const over = amount > 0;
  return (
    <span className={over ? 'text-success' : 'text-danger'}>
      <MoneyText amount={amount} currency={currency} className={over ? 'text-success' : 'text-danger'} />
    </span>
  );
}
