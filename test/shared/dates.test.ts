import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isIsoDate, isoWeekKey, mondayOf, todayInOslo } from '../../src/shared/dates';

describe('isIsoDate', () => {
  it('accepts a valid civil date', () => {
    expect(isIsoDate('2026-09-06')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
  });
});

describe('isoWeekKey', () => {
  it('matches the documented examples', () => {
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });

  it('handles a year where week 1 starts in late December', () => {
    // 2025-12-29 is a Monday and belongs to ISO week 1 of 2026.
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
  });
});

describe('mondayOf', () => {
  it('matches the documented example', () => {
    expect(mondayOf('2026-09-06')).toBe('2026-08-31');
  });

  it('returns the same date when it is already a Monday', () => {
    expect(mondayOf('2026-08-31')).toBe('2026-08-31');
  });
});

describe('diffDays', () => {
  it('returns whole days across a DST change', () => {
    // Europe/Oslo switches to summer time on 2026-03-29; diffDays only ever sees civil dates.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('returns a negative number when b is before a', () => {
    expect(diffDays('2026-09-06', '2026-09-01')).toBe(-5);
  });
});

describe('addDays', () => {
  it('adds whole days and rolls over month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });
});

describe('todayInOslo', () => {
  it('is ahead of UTC during summer time', () => {
    expect(todayInOslo(new Date('2026-03-29T23:30:00Z'))).toBe('2026-03-30');
  });

  it('is ahead of UTC during winter time', () => {
    expect(todayInOslo(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });
});
