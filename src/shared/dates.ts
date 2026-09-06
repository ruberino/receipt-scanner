const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function toUtcDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** b - a in whole days, both civil dates. */
export function diffDays(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / msPerDay);
}

export function addDays(date: string, days: number): string {
  const d = toUtcDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** The Monday of the ISO week containing `date`. */
export function mondayOf(date: string): string {
  const d = toUtcDate(date);
  const isoDayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  d.setUTCDate(d.getUTCDate() - isoDayOfWeek);
  return toIsoDate(d);
}

/** ISO week key `YYYY-Www` for `date`, per ISO 8601 week numbering (Monday start, week 1 contains the first Thursday). */
export function isoWeekKey(date: string): string {
  const d = toUtcDate(date);
  const isoDayOfWeek = (d.getUTCDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - isoDayOfWeek + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 1));
  const firstThursdayDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayOfWeek + 3);
  const weekNumber = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${isoYear}-W${weekNumber.toString().padStart(2, '0')}`;
}

/** Today's civil date in the browser's local time zone, for client-side use. */
export function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear().toString().padStart(4, '0');
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const OSLO_FORMATTER = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' });

/** Today's civil date in Europe/Oslo, for server-side use; sv-SE formats as YYYY-MM-DD. */
export function todayInOslo(now: Date = new Date()): string {
  return OSLO_FORMATTER.format(now);
}
