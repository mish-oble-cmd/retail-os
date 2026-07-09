import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // Relative asset paths so the same build works from file:// inside the
  // packaged Electron app.
  base: './',
});
