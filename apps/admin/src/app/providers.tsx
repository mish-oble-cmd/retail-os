'use client';

import { DensityProvider } from '@retailos/ui';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <DensityProvider density="admin">{children}</DensityProvider>;
}
