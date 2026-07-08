import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@retailos/ui/tokens/tokens.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'RetailOS Admin',
  description: 'Back office for RetailOS stores',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
