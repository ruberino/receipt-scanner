import { describe, expect, it } from 'vitest';
import {
  addDays,
  diffDays,
  isIsoDate,
  isoWeekKey,
  mondayOf,
  todayInOslo,
  todayLocalIso,
} from '../../src/shared/dates.ts';

describe('isIsoDate', () => {
  it('accepts valid civil dates', () => {
    expect(isIsoDate('2026-09-06')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2000-01-01')).toBe(true);
  });

  it('rejects the wrong format', () => {
    expect(isIsoDate('2026-9-6')).toBe(false);
    expect(isIsoDate('06-09-2026')).toBe(false);
    expect(isIsoDate('2026/09/06')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('rejects dates that do not exist on the calendar', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
    expect(isIsoDate('2026-04-31')).toBe(false);
  });
});

describe('isoWeekKey', () => {
  it('matches the documented examples', () => {
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  });

  it('puts late December into week 1 of the next year when that week holds 4 January', () => {
    expect(isoWeekKey('2025-12-29')).toBe('2026-W01');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  });

  it('starts week 1 on the Monday on or before 4 January, for every weekday 1 January can fall on', () => {
    expect(isoWeekKey('2027-01-04')).toBe('2027-W01'); // 1 Jan 2027 is a Friday
    expect(isoWeekKey('2021-01-04')).toBe('2021-W01'); // 1 Jan 2021 is a Friday
    expect(isoWeekKey('2022-01-03')).toBe('2022-W01'); // 1 Jan 2022 is a Saturday
    expect(isoWeekKey('2023-01-02')).toBe('2023-W01'); // 1 Jan 2023 is a Sunday
    expect(isoWeekKey('2024-01-01')).toBe('2024-W01'); // Monday
    expect(isoWeekKey('2019-01-01')).toBe('2019-W01'); // Tuesday
    expect(isoWeekKey('2025-01-01')).toBe('2025-W01'); // Wednesday
  });

  it('gives 52 or 53 weeks depending on the year', () => {
    expect(isoWeekKey('2016-12-31')).toBe('2016-W52');
    expect(isoWeekKey('2020-12-31')).toBe('2020-W53');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2027-06-15')).toBe('2027-W24');
  });

  it('agrees with mondayOf for every day of a week', () => {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDays('2026-08-31', offset);
      expect(isoWeekKey(date)).toBe(isoWeekKey(mondayOf(date)));
    }
  });

  it('throws on invalid input', () => {
    expect(() => isoWeekKey('not-a-date')).toThrow(/Invalid ISO date/);
    expect(() => isoWeekKey('2026-02-30')).toThrow(/Invalid ISO date/);
    expect(() => isoWeekKey('')).toThrow(/Invalid ISO date/);
  });
});

describe('mondayOf', () => {
  it('matches the documented example', () => {
    expect(mondayOf('2026-09-06')).toBe('2026-08-31');
  });

  it('returns the same date when it is already a Monday', () => {
    expect(mondayOf('2026-08-31')).toBe('2026-08-31');
  });

  it('crosses the year boundary', () => {
    expect(mondayOf('2026-01-01')).toBe('2025-12-29');
    expect(mondayOf('2027-01-02')).toBe('2026-12-28');
  });

  it('throws on invalid input', () => {
    expect(() => mondayOf('2026-13-45')).toThrow(/Invalid ISO date/);
  });
});

describe('diffDays', () => {
  it('returns whole days across a DST change', () => {
    // Europe/Oslo switches to summer time on 2026-03-29; diffDays only ever sees civil dates.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('returns zero for the same date and a negative number when b is before a', () => {
    expect(diffDays('2026-09-06', '2026-09-06')).toBe(0);
    expect(diffDays('2026-09-06', '2026-09-01')).toBe(-5);
  });

  it('throws on invalid input', () => {
    expect(() => diffDays('2026-09-06', 'later')).toThrow(/Invalid ISO date/);
  });
});

describe('addDays', () => {
  it('adds whole days and rolls over month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-09-06', 0)).toBe('2026-09-06');
  });

  it('throws on invalid input', () => {
    expect(() => addDays('2026-09-06', 1.5)).toThrow(/integer/);
    expect(() => addDays('2026-09-06', Number.NaN)).toThrow(/integer/);
    expect(() => addDays('2026-02-30', 1)).toThrow(/Invalid ISO date/);
  });
});

describe('todayInOslo', () => {
  it('is ahead of UTC during summer time', () => {
    expect(todayInOslo(new Date('2026-03-29T23:30:00Z'))).toBe('2026-03-30');
    expect(todayInOslo(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });

  it('is ahead of UTC during winter time', () => {
    expect(todayInOslo(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('keeps the UTC date when the Oslo day has not rolled over', () => {
    expect(todayInOslo(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15');
  });
});

describe('todayLocalIso', () => {
  it('returns a valid civil date string', () => {
    expect(isIsoDate(todayLocalIso())).toBe(true);
  });
});
