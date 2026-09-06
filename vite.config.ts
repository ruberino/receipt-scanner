import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // src/client/api/ shares the /api URL prefix with the backend, so a plain string target
      // here would proxy client.ts/queries.ts to Fastify instead of letting Vite serve them.
      // Real API calls never end in .ts/.tsx, so only those bypass the proxy.
      '/api': {
        target: 'http://localhost:3000',
        bypass: (req) => {
          const path = (req.url ?? '').split('?')[0] ?? '';
          return /\.tsx?$/.test(path) ? req.url : undefined;
        },
      },
    },
  },
});
