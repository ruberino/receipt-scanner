const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns the UTC midnight for a civil date, or null when the string is malformed or not on the calendar. */
function parseUtcDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // setUTCFullYear avoids Date.UTC's mapping of years 0–99 to 1900–1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const onCalendar =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return onCalendar ? date : null;
}

function toUtcDate(value: string): Date {
  const date = parseUtcDate(value);
  if (!date) {
    throw new Error(`Invalid ISO date: ${JSON.stringify(value)}`);
  }
  return date;
}

function toIsoDate(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Monday = 0 … Sunday = 6. */
function isoDayOfWeek(date: Date): number {
  return (date.getUTCDay() + 6) % 7;
}

/** Validates a civil date string, format and calendar both, e.g. rejects "2026-02-30". */
export function isIsoDate(value: string): boolean {
  return parseUtcDate(value) !== null;
}

/** b − a in whole days; both are civil dates, so DST never affects the result. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) {
    throw new Error(`days must be an integer: ${String(days)}`);
  }
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return toIsoDate(result);
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: string): string {
  const result = toUtcDate(date);
  result.setUTCDate(result.getUTCDate() - isoDayOfWeek(result));
  return toIsoDate(result);
}

/** ISO 8601 week key `YYYY-Www`: weeks start on Monday and week 1 is the week containing 4 January. */
export function isoWeekKey(date: string): string {
  const thursday = toUtcDate(date);
  thursday.setUTCDate(thursday.getUTCDate() - isoDayOfWeek(thursday) + 3);
  const isoYear = thursday.getUTCFullYear();

  const week1Thursday = new Date(0);
  week1Thursday.setUTCFullYear(isoYear, 0, 4);
  week1Thursday.setUTCDate(4 - isoDayOfWeek(week1Thursday) + 3);

  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * MS_PER_DAY));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Today in the browser's local time zone, for display defaults only (ADR-0007).
 * Purchase dates, week keys and anything persisted must come from the server's `todayInOslo`.
 */
export function todayLocalIso(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const OSLO_FORMATTER = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' });

/** Today's civil date in Europe/Oslo; sv-SE formats as YYYY-MM-DD. */
export function todayInOslo(now: Date = new Date()): string {
  return OSLO_FORMATTER.format(now);
}
