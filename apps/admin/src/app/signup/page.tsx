'use client';

import { ApiError } from '@retailos/api-client';
import { Button, Card, Input } from '@retailos/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/v1/auth/signup', {
        store_name: form.get('store_name'),
        currency: String(form.get('currency') ?? '').toUpperCase(),
        email: form.get('email'),
        password: form.get('password'),
      });
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? (err.problem.errors?.[0]?.message ?? err.problem.title)
          : 'Could not reach the server. Is the API running?',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-h2 font-semibold text-ink">Create your store</h1>
        <p className="mb-5 text-body-sm text-ink-muted">
          The quick version — the full onboarding wizard comes later.
        </p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input name="store_name" label="Store name" placeholder="Bahay Kubo Grocers" required />
          <Input
            name="currency"
            label="Currency"
            defaultValue="PHP"
            pattern="[A-Za-z]{3}"
            hint="ISO code, e.g. PHP"
            required
          />
          <Input name="email" type="email" label="Email" autoComplete="email" required />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="new-password"
            minLength={10}
            hint="At least 10 characters"
            required
          />
          {error ? <p className="text-body-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create store'}
          </Button>
        </form>
        <p className="mt-4 text-body-sm text-ink-muted">
          Already have a store?{' '}
          <Link href="/login" className="font-medium text-primary">
            Sign in
          </Link>
        </p>
      </Card>
    </main>
  );
}
