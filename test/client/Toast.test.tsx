/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../src/client/components/Toast.tsx';

function TestHarness() {
  const { showToast } = useToast();
  return (
    <button type="button" onClick={() => showToast('Lagret')}>
      Vis
    </button>
  );
}

function renderHarness() {
  render(
    <ToastProvider>
      <TestHarness />
    </ToastProvider>,
  );
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the text after showToast, positioned fixed above the bottom nav', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Lagret');
    expect(screen.getByRole('status')).toHaveClass('fixed');
  });

  it('disappears after 3 seconds', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button'));
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a second showToast within 3 seconds resets the timer', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button')); // t=0
    });
    act(() => {
      vi.advanceTimersByTime(2000); // t=2s
    });
    act(() => {
      fireEvent.click(screen.getByRole('button')); // second call at t=2s
    });
    act(() => {
      vi.advanceTimersByTime(2000); // t=4s, 2s since the second call
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
