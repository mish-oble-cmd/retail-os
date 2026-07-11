'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { label: 'Locations & registers', href: '/settings/registers' },
  { label: 'Staff', href: '/settings/staff' },
];

/** Settings sub-nav shared by the registers and staff pages (1F). */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex gap-1 border-b border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={`-mb-px border-b-2 px-3 py-2 text-body-sm ${
            pathname.startsWith(tab.href)
              ? 'border-ink font-semibold text-ink'
              : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
