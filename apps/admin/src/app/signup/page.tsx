'use client';

import { ApiError } from '@retailos/api-client';
import { Button, Card, Input } from '@retailos/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { onboardingApi } from '../../lib/onboarding-api';

/**
 * ADM-01 onboarding wizard (1E, FR-10.1): Account → Store profile → Starting
 * catalog. The bare centered stage is deliberate — there is no store to
 * navigate yet. Everything here is changeable later in Settings, so nothing
 * should feel like a commitment worth stalling on (the <15-minute target).
 */
type Step = 1 | 2 | 3;

const STEP_LABELS: Record<Step, string> = {
  1: 'Account',
  2: 'Store profile',
  3: 'Starting catalog',
};

export default function SignupWizardPage() {
  const [step, setStep] = useState<Step>(1);

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg">
      <header className="flex w-full items-center px-8 py-5">
        <span className="text-body font-bold tracking-tight text-ink">
          RetailOS{' '}
          <span className="ml-2 text-body-sm font-normal text-ink-muted">Set up your store</span>
        </span>
      </header>

      <Steps current={step} />

      {step === 1 && <AccountStep onDone={() => setStep(2)} />}
      {step === 2 && <StoreProfileStep onBack={() => setStep(1)} onDone={() => setStep(3)} />}
      {step === 3 && <CatalogStep onBack={() => setStep(2)} />}
    </main>
  );
}

function Steps({ current }: { current: Step }) {
  return (
    <div className="mb-6 mt-7 flex items-center gap-6">
      {([1, 2, 3] as Step[]).map((n, i) => (
        <div key={n} className="flex items-center gap-2">
          <span
            className={
              'flex h-6 w-6 items-center justify-center rounded-full border text-caption font-semibold ' +
              (n < current
                ? 'border-primary bg-primary text-white'
                : n === current
                  ? 'border-primary text-primary'
                  : 'border-border text-ink-muted')
            }
          >
            {n < current ? '✓' : n}
          </span>
          <span
            className={
              'text-body-sm ' + (n === current ? 'font-semibold text-ink' : 'text-ink-muted')
            }
          >
            {STEP_LABELS[n]}
          </span>
          {i < 2 && <span className="ml-4 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function AccountStep({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pwRemaining = Math.max(0, 10 - password.length);
  const canSubmit = password.length >= 10 && !busy;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError(null);
    setPwError(null);
    if (password.length < 10) {
      setPwError(
        `At least 10 characters — this one is ${password.length}. A short phrase works well.`,
      );
      return;
    }
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/v1/auth/signup', {
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
        // Provisional — the real store name is collected in step 2.
        store_name: 'My store',
        currency: 'SGD',
      });
      onDone();
    } catch (err) {
      const message =
        err instanceof ApiError ? (err.problem.errors?.[0]?.message ?? err.problem.title) : '';
      if (err instanceof ApiError && /already exists/i.test(message)) {
        setEmailError('This email already has a store — sign in instead?');
      } else {
        setEmailError(message || 'Could not reach the server. Is the API running?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-[520px] max-w-full">
      <h1 className="mb-1 text-h3 font-semibold text-ink">Create your account</h1>
      <p className="mb-5 text-body-sm text-ink-muted">
        You&apos;ll be the store Owner — full permissions, including the register approval PIN.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input name="name" label="Your name" placeholder="Bea Santos" required />
        <div>
          <Input
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            required
            error={emailError ?? undefined}
          />
          {emailError && /sign in/i.test(emailError) ? (
            <p className="mt-1 text-caption text-ink-muted">
              <Link href="/login" className="font-semibold text-primary">
                Sign in
              </Link>
            </p>
          ) : null}
        </div>
        <Input
          name="password"
          type="password"
          label="Password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          error={pwError ?? undefined}
          hint={
            pwError
              ? undefined
              : pwRemaining > 0
                ? `At least 10 characters — ${pwRemaining} to go. A short phrase works well.`
                : 'Looks good.'
          }
        />
        <p className="text-caption text-ink-muted">
          By continuing you agree to the Terms &amp; Privacy Policy.
        </p>
        <Button type="submit" disabled={!canSubmit} className="w-full">
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-4 text-body-sm text-ink-muted">
        Already have a store?{' '}
        <Link href="/login" className="font-medium text-primary">
          Sign in
        </Link>
      </p>
    </Card>
  );
}

function StoreProfileStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const detectedTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Singapore';
    } catch {
      return 'Asia/Singapore';
    }
  }, []);
  const [priceMode, setPriceMode] = useState<'tax_inclusive' | 'tax_exclusive'>('tax_inclusive');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await onboardingApi.updateStore({
        name: String(form.get('store_name') ?? ''),
        currency: String(form.get('currency') ?? 'SGD').toUpperCase(),
        timezone: String(form.get('timezone') ?? detectedTz),
        price_mode: priceMode,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.problem.title : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-[520px] max-w-full">
      <h1 className="mb-1 text-h3 font-semibold text-ink">Tell us about the store</h1>
      <p className="mb-5 text-body-sm text-ink-muted">
        This prints on every receipt and sets how prices and taxes work. About 2 minutes.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Input name="store_name" label="Store name" placeholder="Bahay Kubo Grocers" required />
        <div className="grid grid-cols-2 gap-3">
          <Input name="currency" label="Currency" defaultValue="SGD" pattern="[A-Za-z]{3}" required />
          <Input name="timezone" label="Timezone" defaultValue={detectedTz} hint="detected" required />
        </div>
        <div>
          <p className="mb-1 text-body-sm font-medium text-ink">Prices and tax</p>
          <div className="inline-flex overflow-hidden rounded border border-border">
            <button
              type="button"
              onClick={() => setPriceMode('tax_inclusive')}
              className={
                'px-4 py-2 text-body-sm ' +
                (priceMode === 'tax_inclusive' ? 'bg-primary font-semibold text-white' : 'text-ink')
              }
            >
              Prices include tax
            </button>
            <button
              type="button"
              onClick={() => setPriceMode('tax_exclusive')}
              className={
                'px-4 py-2 text-body-sm ' +
                (priceMode === 'tax_exclusive' ? 'bg-primary font-semibold text-white' : 'text-ink')
              }
            >
              Add tax at the till
            </button>
          </div>
          <p className="mt-2 text-caption text-ink-muted">
            Singapore shelf prices usually already include GST — keep this unless your accountant
            says otherwise. Rate and categories are editable later in Settings → Taxes.
          </p>
        </div>
        {error ? <p className="text-body-sm text-danger">{error}</p> : null}
        <div className="flex items-center">
          <button type="button" onClick={onBack} className="text-body-sm text-ink-muted">
            ‹ Back
          </button>
          <Button type="submit" disabled={busy} className="ml-auto">
            {busy ? 'Saving…' : 'Continue'}
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-caption text-ink-muted">
        Everything here can be changed later in Settings — nothing is carved in stone.
      </p>
    </Card>
  );
}

function CatalogStep({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<'sample' | 'empty'>('sample');
  const [busy, setBusy] = useState(false);

  async function finish() {
    setBusy(true);
    try {
      if (choice === 'sample') await onboardingApi.seedSample();
    } catch {
      // Non-fatal: the checklist still lets them load it later.
    } finally {
      router.push('/dashboard');
    }
  }

  return (
    <Card className="w-[520px] max-w-full">
      <h1 className="mb-1 text-h3 font-semibold text-ink">How do you want to start?</h1>
      <p className="mb-5 text-body-sm text-ink-muted">
        You can try selling in the next minute, or begin with your real products.
      </p>
      <div className="flex flex-col gap-3">
        <ChoiceCard
          selected={choice === 'sample'}
          onSelect={() => setChoice('sample')}
          title="Load the sample catalog — recommended for a test drive"
          body="40 Singapore convenience-store products with prices, barcodes, categories, and stock, arranged on a register grid. Ring up practice sales, then delete it all with one click when you're ready to go live."
        >
          <div className="mt-2 flex flex-wrap gap-1.5">
            {['Milo (can) $2.10', 'Maggi Curry Cup $2.20', '100PLUS $1.70', '+37 more'].map(
              (chip) => (
                <span
                  key={chip}
                  className="rounded bg-bg px-2 py-1 text-caption font-semibold text-primary"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </ChoiceCard>
        <ChoiceCard
          selected={choice === 'empty'}
          onSelect={() => setChoice('empty')}
          title="Start with an empty catalog"
          body="Add products one at a time, or import a CSV — the template covers names, prices, barcodes, variants, and starting stock."
        />
      </div>
      <div className="mt-6 flex items-center">
        <button type="button" onClick={onBack} className="text-body-sm text-ink-muted">
          ‹ Back
        </button>
        <Button type="button" onClick={finish} disabled={busy} className="ml-auto">
          {busy ? 'Finishing…' : 'Finish setup'}
        </Button>
      </div>
    </Card>
  );
}

function ChoiceCard({
  selected,
  onSelect,
  title,
  body,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'flex gap-3 rounded-card border p-4 text-left ' +
        (selected ? 'border-2 border-primary bg-bg' : 'border-border')
      }
    >
      <span
        className={
          'mt-0.5 h-4 w-4 flex-none rounded-full border ' +
          (selected ? 'border-[5px] border-primary' : 'border-border')
        }
      />
      <span>
        <span className="block text-body-sm font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-caption text-ink-muted">{body}</span>
        {children}
      </span>
    </button>
  );
}
