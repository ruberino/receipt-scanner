import { diffDays, todayLocalIso } from '../../shared/dates.ts';

export { formatOre } from '../../shared/money.ts';

const DATE_FORMATTER = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });

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

/** `formatQuantity(1.5, 'kg')` → `1,5 kg`; `formatQuantity(2, null)` → `2`. */
export function formatQuantity(quantity: number, unit: string | null): string {
  const formattedQuantity = String(quantity).replace('.', ',');
  return unit === null ? formattedQuantity : `${formattedQuantity} ${unit}`;
}
