'use client';

import { Button } from '@retailos/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type MeResource } from '../lib/api';

const NAV: Array<{ label: string; href: string; enabled: boolean }> = [
  { label: 'Home', href: '/dashboard', enabled: true },
  { label: 'Orders', href: '/orders', enabled: false },
  { label: 'Products', href: '/products', enabled: true },
  { label: 'Inventory', href: '/inventory', enabled: false },
  { label: 'Customers', href: '/customers', enabled: false },
  { label: 'Reports', href: '/reports', enabled: false },
  { label: 'Settings', href: '/settings/registers', enabled: true },
];

/**
 * Admin AppShell per ADM-02/03 mockups: 224px sidebar, topbar slot per page.
 * Disabled entries are visible-but-inert (mockup: future phases are a visible
 * promise, not a hidden one).
 */
export function AppShell({
  title,
  topbar,
  children,
}: {
  title: string;
  topbar?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<MeResource | null>(null);

  useEffect(() => {
    api
      .get<MeResource>('/api/v1/auth/me')
      .then(setMe)
      .catch(() => router.replace('/login'));
  }, [router]);

  if (!me) {
    return (
      <main className="flex min-h-screen items-center justify-center text-ink-muted">Loading…</main>
    );
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="flex w-56 flex-none flex-col border-r border-border bg-surface p-3">
        <div className="px-3 pb-4 pt-1">
          <p className="text-body font-semibold text-ink">{me.name}</p>
          <p className="text-caption text-ink-muted">RetailOS admin</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) =>
            item.enabled ? (
              <Link
                key={item.label}
                href={item.href}
                className={
                  pathname.startsWith(item.href) ||
                  (item.href === '/products' && pathname.startsWith('/categories'))
                    ? 'rounded bg-bg px-3 py-2 text-body-sm font-semibold text-primary'
                    : 'rounded px-3 py-2 text-body-sm text-ink hover:bg-bg'
                }
              >
                {item.label}
              </Link>
            ) : (
              <span
                key={item.label}
                className="cursor-default rounded px-3 py-2 text-body-sm text-ink-muted opacity-60"
                title="Arrives in a later phase"
              >
                {item.label}
              </span>
            ),
          )}
        </nav>
        <div className="mt-auto px-3">
          <Button variant="ghost" size="sm" onClick={() => void logout(router.replace)}>
            Sign out
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 flex-none items-center gap-3 border-b border-border bg-surface px-6">
          <h1 className="text-h3 font-semibold text-ink">{title}</h1>
          {topbar}
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

async function logout(replace: (href: string) => void) {
  await api.post('/api/v1/auth/logout').catch(() => undefined);
  replace('/login');
}
