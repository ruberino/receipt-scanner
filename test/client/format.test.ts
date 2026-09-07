import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateWithRelative,
  formatOre,
  formatRelativeDate,
  formatWeek,
} from '../../src/client/lib/format.ts';

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

describe('formatDateWithRelative (T33)', () => {
  it('shows the short date and "i dag" for today', () => {
    expect(formatDateWithRelative('2026-09-07', '2026-09-07')).toBe('7. sep. · i dag');
  });

  it('shows the short date and the days-ago form within 30 days', () => {
    expect(formatDateWithRelative('2026-09-04', '2026-09-07')).toBe('4. sep. · 3 dager siden');
  });

  it('shows the short date once, not twice, beyond 30 days', () => {
    // Not July: nb-NO's short month form leaves "juli" unabbreviated (no trailing "."), which
    // would make a same-string comparison pass for the wrong reason.
    expect(formatDateWithRelative('2026-08-01', '2026-09-07')).toBe('1. aug.');
  });
});

describe('formatWeek', () => {
  it('labels a week start with its ISO week number and year, not a date (T23 F1)', () => {
    expect(formatWeek('2026-08-24')).toBe('Uke 35, 2026');
    expect(formatWeek('2026-09-07')).toBe('Uke 37, 2026');
  });
});

describe('formatOre (re-export)', () => {
  it('formats øre as Norwegian kroner', () => {
    expect(formatOre(4380)).toBe(`43,80${NBSP}kr`);
  });
});
