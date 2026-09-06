import { diffDays, isoWeekKey, todayLocalIso } from '../../shared/dates.ts';

export { formatOre } from '../../shared/money.ts';

const DATE_FORMATTER = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
const MONTH_FORMATTER = new Intl.DateTimeFormat('nb-NO', { month: 'short', year: 'numeric' });

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!));
}

/** `formatDate('2026-09-03')` → `3. sep. 2026`. */
export function formatDate(date: string): string {
  return DATE_FORMATTER.format(toUtcDate(date));
}

/** `today` defaults to the browser's local date (ADR-0007); display only, never persisted. */
export function formatRelativeDate(date: string, today: string = todayLocalIso()): string {
  const days = diffDays(date, today);
  if (days === 0) {
    return 'i dag';
  }
  if (days === 1) {
    return 'i går';
  }
  if (days > 1 && days <= 30) {
    return `${days} dager siden`;
  }
  return SHORT_DATE_FORMATTER.format(toUtcDate(date));
}

/** `formatMonth('2026-07')` → `jul. 2026`. */
export function formatMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return MONTH_FORMATTER.format(new Date(Date.UTC(year!, monthNumber! - 1, 1)));
}

/** `formatWeek('2026-08-24')` → `Uke 35, 2026`, via `isoWeekKey`'s `2026-W35`. */
export function formatWeek(weekStart: string): string {
  const [isoYear, week] = isoWeekKey(weekStart).split('-W');
  return `Uke ${Number(week)}, ${isoYear}`;
}

/** `formatQuantity(1.5, 'kg')` → `1,5 kg`; `formatQuantity(2, null)` → `2`. */
export function formatQuantity(quantity: number, unit: string | null): string {
  const formattedQuantity = String(quantity).replace('.', ',');
  return unit === null ? formattedQuantity : `${formattedQuantity} ${unit}`;
}
