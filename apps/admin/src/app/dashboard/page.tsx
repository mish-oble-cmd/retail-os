'use client';

import { Badge, Button, Card } from '@retailos/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type MeResource } from '../../lib/api';

const NAV = ['Home', 'Orders', 'Products', 'Inventory', 'Customers', 'Reports', 'Settings'];

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResource | null>(null);

  useEffect(() => {
    api
      .get<MeResource>('/api/v1/auth/me')
      .then(setMe)
      .catch(() => router.replace('/login'));
  }, [router]);

  async function logout() {
    await api.post('/api/v1/auth/logout').catch(() => undefined);
    router.replace('/login');
  }

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-none flex-col border-r border-border bg-surface p-3">
        <div className="px-3 pb-4 pt-1">
          <p className="text-body font-semibold text-ink">{me.name}</p>
          <p className="text-caption text-ink-muted">RetailOS admin</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <span
              key={item}
              className={
                item === 'Home'
                  ? 'rounded bg-bg px-3 py-2 text-body-sm font-semibold text-primary'
                  : 'rounded px-3 py-2 text-body-sm text-ink-muted'
              }
            >
              {item}
            </span>
          ))}
        </nav>
        <div className="mt-auto px-3">
          <Button variant="ghost" size="sm" onClick={logout}>
            Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <header className="mb-6 flex items-center justify-between">
          <h1 className="text-h2 font-semibold text-ink">Home</h1>
          <Badge tone="success">Signed in as {me.role}</Badge>
        </header>
        <Card className="mx-auto mt-16 max-w-lg text-center">
          <div className="py-8">
            <p className="text-h1">🌱</p>
            <h2 className="mt-2 text-h3 font-semibold text-ink">Welcome to your store</h2>
            <p className="mx-auto mt-2 max-w-sm text-body-sm text-ink-muted">
              The empty admin shell is Phase 0’s finish line. Products, orders, and the real
              dashboard arrive in Phase 1.
            </p>
          </div>
        </Card>
      </main>
    </div>
  );
}
