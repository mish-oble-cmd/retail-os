import { DensityProvider } from '@retailos/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@retailos/ui/tokens/tokens.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DensityProvider density="pos">
      <App />
    </DensityProvider>
  </StrictMode>,
);
