import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setupTests.ts'],
    // First Fastify boot on a cold module cache can exceed 5 s on Windows.
    testTimeout: 15000,
  },
});
