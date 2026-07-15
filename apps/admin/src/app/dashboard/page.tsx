'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../../components/app-shell';
import { onboardingApi, type OnboardingStatus } from '../../lib/onboarding-api';

/**
 * Home (ADM-01, 1E): the first-sale checklist over an empty-state dashboard.
 * The checklist headline counts down time, not tasks — the same <15-minute
 * promise FR-10.1 makes, kept visibly. Polls onboarding status so steps flip as
 * the register activates and rings a sale. The live dashboard (StatCards +
 * charts) is ADM-02, a later phase; day zero shows an intentional empty state.
 */
export default function HomePage() {
  const status = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: onboardingApi.getStatus,
    refetchInterval: 5000,
  });

  return (
    <AppShell title="Home">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {status.data && !status.data.dismissed && !allDone(status.data) ? (
          <Checklist status={status.data} />
        ) : null}
        <EmptyDashboard currency={status.data?.currency ?? ''} />
      </div>
    </AppShell>
  );
}

function allDone(s: OnboardingStatus): boolean {
  return Object.values(s.steps).every(Boolean);
}

function doneCount(s: OnboardingStatus): number {
  return Object.values(s.steps).filter(Boolean).length;
}

function Checklist({ status }: { status: OnboardingStatus }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: onboardingApi.dismiss,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['onboarding-status'] }),
  });

  const done = doneCount(status);
  const s = status.steps;

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="mb-1 flex items-center gap-3">
        <h3 className="text-body font-semibold text-ink">
          {status.minutes_remaining > 0
            ? `First sale in about ${status.minutes_remaining} more minutes`
            : 'Setup complete'}
        </h3>
        <span className="text-body-sm text-ink-muted">{done} of 5 done</span>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          className="ml-auto text-body-sm text-ink-muted hover:text-ink"
        >
          I&apos;ve done this before — hide
        </button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-primary" style={{ width: `${(done / 5) * 100}%` }} />
      </div>

      <ul>
        <Item done={s.account} label="Create your account" />
        <Item done={s.store_profile} label={`Set up ${status.store_name || 'your store'}`} />
        <Item
          done={s.catalog}
          label="Load a starting catalog"
          detail={s.catalog ? undefined : 'Add products, import a CSV, or load the sample catalog from setup.'}
        />
        <Item
          done={s.register}
          label="Connect a register"
          detail={
            s.register || !status.activation_code ? undefined : (
              <span>
                Open the POS app on your till and enter code{' '}
                <span className="font-money font-semibold text-ink">{status.activation_code}</span>
                {status.activation_expires_at ? (
                  <span className="text-ink-muted"> · expires {expiryHint(status.activation_expires_at)}</span>
                ) : null}
              </span>
            )
          }
        />
        <Item
          done={s.first_sale}
          label="Ring up your first sale"
          blocked={!s.first_sale ? status.blocked.first_sale : undefined}
          detail={
            s.first_sale || status.blocked.first_sale
              ? undefined
              : 'Anything, cash is fine — it appears here the moment the register syncs.'
          }
        />
      </ul>
    </div>
  );
}

function Item({
  done,
  label,
  detail,
  blocked,
}: {
  done: boolean;
  label: string;
  detail?: React.ReactNode;
  blocked?: string;
}) {
  return (
    <li className="flex items-start gap-3 border-b border-border py-3 last:border-b-0">
      <span
        className={
          'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border text-caption ' +
          (done ? 'border-primary bg-primary text-white' : 'border-border text-ink-muted')
        }
      >
        {done ? '✓' : ''}
      </span>
      <div className={'min-w-0 ' + (blocked ? 'opacity-60' : '')}>
        <p className={'text-body-sm ' + (done ? 'text-ink-muted line-through' : 'font-medium text-ink')}>
          {label}
        </p>
        {blocked ? <p className="mt-0.5 text-caption text-ink-muted">{blocked}</p> : null}
        {detail ? <p className="mt-0.5 text-caption text-ink-muted">{detail}</p> : null}
      </div>
    </li>
  );
}

function EmptyDashboard({ currency }: { currency: string }) {
  const cur = currency || '—';
  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Revenue today" value={`${cur} —`} />
        <Stat label="Transactions" value="—" />
        <Stat label="Average basket" value={`${cur} —`} />
      </div>
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <p className="text-body font-semibold text-ink">Your first sale lights this up</p>
        <p className="mt-1 text-body-sm text-ink-muted">
          Sales by hour and top items appear once a register rings one up.
        </p>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-caption uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-money text-h3 text-ink">{value}</p>
    </div>
  );
}

function expiryHint(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'soon';
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `in ${hours} h`;
  const mins = Math.max(1, Math.round(ms / (60 * 1000)));
  return `in ${mins} min`;
}
