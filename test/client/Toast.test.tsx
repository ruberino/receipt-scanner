/** @vitest-environment jsdom */
import { act } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from '../../src/client/components/Toast.tsx';

function TestHarness({ onAction = () => {} }: { onAction?: () => void }) {
  const { showToast } = useToast();
  return (
    <>
      <button type="button" onClick={() => showToast('Lagret')}>
        Vis
      </button>
      <button
        type="button"
        onClick={() => showToast('«Lettmelk 1 l» fjernet', { actionLabel: 'Angre', onAction })}
      >
        Vis med angre
      </button>
    </>
  );
}

function renderHarness(onAction?: () => void) {
  render(
    <ToastProvider>
      <TestHarness onAction={onAction} />
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
      fireEvent.click(screen.getByRole('button', { name: 'Vis' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('Lagret');
    expect(screen.getByRole('status')).toHaveClass('fixed');
  });

  it('disappears after 3 seconds', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis' }));
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a second showToast within 3 seconds resets the timer', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis' })); // t=0
    });
    act(() => {
      vi.advanceTimersByTime(2000); // t=2s
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis' })); // second call at t=2s
    });
    act(() => {
      vi.advanceTimersByTime(2000); // t=4s, 2s since the second call
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows an action button and stays for 6 seconds instead of 3 (T31)', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis med angre' }));
    });

    expect(screen.getByRole('status')).toHaveTextContent('«Lettmelk 1 l» fjernet');
    expect(screen.getByRole('button', { name: 'Angre' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls onAction and dismisses immediately when the action button is tapped (T31)', () => {
    const onAction = vi.fn();
    renderHarness(onAction);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis med angre' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Angre' }));
    });

    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('a plain toast without an action still uses the 3 second duration after an action toast', () => {
    renderHarness();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis med angre' }));
    });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Vis' }));
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
