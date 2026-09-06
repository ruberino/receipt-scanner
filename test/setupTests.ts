import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// RTL only registers its own cleanup when `afterEach` is a global; globals stay off, so do it here.
afterEach(async () => {
  if (typeof document === 'undefined') {
    return;
  }
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
