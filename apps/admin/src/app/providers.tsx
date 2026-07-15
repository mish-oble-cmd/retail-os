'use client';

import { DensityProvider } from '@retailos/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <DensityProvider density="admin">{children}</DensityProvider>
    </QueryClientProvider>
  );
}
