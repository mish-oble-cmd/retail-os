import { createContext, useContext, type ReactNode } from 'react';

/**
 * Density modes (design-system.md §Touch & density): the same components render
 * POS-sized (≥48px targets, 18px body) or admin-sized (36px controls, 14–16px
 * text) based on this context — never via per-screen overrides.
 */
export type Density = 'admin' | 'pos';

const DensityContext = createContext<Density>('admin');

export function DensityProvider({ density, children }: { density: Density; children: ReactNode }) {
  return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>;
}

export function useDensity(): Density {
  return useContext(DensityContext);
}
