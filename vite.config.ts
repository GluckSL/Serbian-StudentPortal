import { defineConfig } from 'vite';

/** Allow ngrok and other tunnel hosts when using `ng serve` (port 4200). */
export default defineConfig({
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
  },
});
