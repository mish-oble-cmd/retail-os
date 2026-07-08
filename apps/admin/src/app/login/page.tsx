'use client';

import { ApiError } from '@retailos/api-client';
import { Button, Card, Input } from '@retailos/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [needsTotp, setNeedsTotp] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      await api.post('/api/v1/auth/login', {
        email: form.get('email'),
        password: form.get('password'),
        ...(form.get('totp_code') ? { totp_code: form.get('totp_code') } : {}),
      });
      router.push('/dashboard');
    } catch (err) {
      if (err instanceof ApiError && /authenticator/i.test(err.problem.title)) {
        setNeedsTotp(true);
        setError('Enter the 6-digit code from your authenticator app.');
      } else if (err instanceof ApiError) {
        setError(err.problem.title);
      } else {
        setError('Could not reach the server. Is the API running?');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-h2 font-semibold text-ink">RetailOS</h1>
        <p className="mb-5 text-body-sm text-ink-muted">Sign in to your store’s back office.</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Input name="email" type="email" label="Email" autoComplete="email" required />
          <Input
            name="password"
            type="password"
            label="Password"
            autoComplete="current-password"
            required
          />
          {needsTotp ? (
            <Input
              name="totp_code"
              label="Authenticator code"
              inputMode="numeric"
              pattern="\d{6}"
              placeholder="123456"
            />
          ) : null}
          {error ? <p className="text-body-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-body-sm text-ink-muted">
          New here?{' '}
          <Link href="/signup" className="font-medium text-primary">
            Create your store
          </Link>
        </p>
      </Card>
    </main>
  );
}
