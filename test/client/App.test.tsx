/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../src/client/App';

describe('App', () => {
  it('renders the app name', () => {
    render(<App />);
    expect(screen.getByText('Kvitteringer')).toBeInTheDocument();
  });
});
