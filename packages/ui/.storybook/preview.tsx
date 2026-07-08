import type { Decorator, Preview } from '@storybook/react';
import { DensityProvider, type Density } from '../src/density.js';
import '../tokens/tokens.css';
import '../src/styles.css';

/**
 * Toolbar globals: theme applies the dark token set via [data-theme];
 * density exercises the POS/admin sizing of every component.
 */
const withThemeAndDensity: Decorator = (Story, context) => {
  const theme = (context.globals['theme'] as string) ?? 'light';
  const density = ((context.globals['density'] as string) ?? 'admin') as Density;
  document.documentElement.setAttribute('data-theme', theme);
  return (
    <DensityProvider density={density}>
      <div className="bg-bg p-6 font-ui text-ink">
        <Story />
      </div>
    </DensityProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Token theme',
      toolbar: { title: 'Theme', items: ['light', 'dark'], dynamicTitle: true },
    },
    density: {
      description: 'Component density',
      toolbar: { title: 'Density', items: ['admin', 'pos'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light', density: 'admin' },
  decorators: [withThemeAndDensity],
};

export default preview;
