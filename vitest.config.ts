import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Fastify's app.inject() hangs under Vitest's default worker_threads pool.
    pool: 'forks',
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setupTests.ts'],
  },
});
