/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/client/App.tsx';

describe('App', () => {
  it('renders the app name', () => {
    render(<App />);
    expect(screen.getByText('Kvitteringer')).toBeInTheDocument();
  });

  it('cleans up between tests so a second render does not see the first', () => {
    render(<App />);
    expect(screen.getAllByText('Kvitteringer')).toHaveLength(1);
  });
});
