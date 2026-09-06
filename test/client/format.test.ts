import { describe, expect, it } from 'vitest';
import { formatDate, formatOre, formatRelativeDate } from '../../src/client/lib/format.ts';

const NBSP = ' ';

describe('formatDate', () => {
  it('formats a civil date with the Norwegian abbreviated month and year', () => {
    expect(formatDate('2026-09-03')).toBe('3. sep. 2026');
  });
});

describe('formatRelativeDate', () => {
  it('returns "i dag" for today', () => {
    expect(formatRelativeDate('2026-09-06', '2026-09-06')).toBe('i dag');
  });

  it('returns "i går" for yesterday', () => {
    expect(formatRelativeDate('2026-09-05', '2026-09-06')).toBe('i går');
  });

  it('returns "N dager siden" between 2 and 30 days', () => {
    expect(formatRelativeDate('2026-09-03', '2026-09-06')).toBe('3 dager siden');
    expect(formatRelativeDate('2026-08-07', '2026-09-06')).toBe('30 dager siden');
  });

  it('returns a short date without a year beyond 30 days', () => {
    expect(formatRelativeDate('2026-08-06', '2026-09-06')).toBe('6. aug.');
  });
});

describe('formatOre (re-export)', () => {
  it('formats øre as Norwegian kroner', () => {
    expect(formatOre(4380)).toBe(`43,80${NBSP}kr`);
  });
});
