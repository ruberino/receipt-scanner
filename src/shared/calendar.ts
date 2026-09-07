import { addDays, diffDays, mondayOf } from './dates.ts';

export type CalendarEvent = {
  date: string;
  endDate?: string;
  name: string;
};

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year as number, (month as number) - 1, day as number));
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of Easter Sunday. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The Monday of ISO week `week` in `year`: week 1's Monday is the Monday of the week containing 4 January. */
function mondayOfIsoWeek(year: number, week: number): string {
  const week1Monday = mondayOf(`${year}-01-04`);
  return addDays(week1Monday, (week - 1) * 7);
}

/** `date` itself if it is a Sunday, otherwise the closest earlier Sunday. */
function nearestSundayOnOrBefore(date: string): string {
  const dayOfWeek = toUtcDate(date).getUTCDay(); // Sunday = 0
  return addDays(date, -dayOfWeek);
}

/** Every fixed or Easter-relative event, and every Oslo school holiday, that recurs each civil `year`. */
function yearEvents(year: number): CalendarEvent[] {
  const easter = easterSunday(year);
  const dec24 = `${year}-12-24`;
  const fourthAdvent = nearestSundayOnOrBefore(dec24);

  const vinterferieStart = mondayOfIsoWeek(year, 8);
  const hostferieStart = mondayOfIsoWeek(year, 40);
  const sommerferieStart = addDays(mondayOfIsoWeek(year, 25), 5); // Saturday of week 25
  const sommerferieEnd = addDays(mondayOfIsoWeek(year, 33), 6); // Sunday of week 33
  const fellesferieStart = mondayOfIsoWeek(year, 28);
  const fellesferieEnd = addDays(mondayOfIsoWeek(year, 30), 6);

  return [
    { date: `${year}-01-01`, name: 'Nyttårsdag' },
    { date: addDays(easter, -3), name: 'Skjærtorsdag' },
    { date: addDays(easter, -2), name: 'Langfredag' },
    { date: easter, name: '1. påskedag' },
    { date: addDays(easter, 1), name: '2. påskedag' },
    { date: `${year}-05-01`, name: '1. mai' },
    { date: addDays(easter, 39), name: 'Kristi himmelfartsdag' },
    { date: `${year}-05-17`, name: '17. mai' },
    { date: addDays(easter, 49), name: '1. pinsedag' },
    { date: addDays(easter, 50), name: '2. pinsedag' },
    { date: `${year}-10-31`, name: 'Halloween' },
    { date: addDays(fourthAdvent, -21), name: '1. søndag i advent' },
    { date: addDays(fourthAdvent, -14), name: '2. søndag i advent' },
    { date: addDays(fourthAdvent, -7), name: '3. søndag i advent' },
    { date: fourthAdvent, name: '4. søndag i advent' },
    { date: dec24, name: 'Julaften' },
    { date: `${year}-12-25`, name: '1. juledag' },
    { date: `${year}-12-26`, name: '2. juledag' },
    { date: `${year}-12-31`, name: 'Nyttårsaften' },
    { date: vinterferieStart, endDate: addDays(vinterferieStart, 6), name: 'Vinterferie (Oslo)' },
    { date: hostferieStart, endDate: addDays(hostferieStart, 6), name: 'Høstferie (Oslo)' },
    { date: `${year}-12-21`, endDate: `${year + 1}-01-01`, name: 'Juleferie (Oslo)' },
    { date: sommerferieStart, endDate: sommerferieEnd, name: 'Sommerferie (Oslo, tilnærmet)' },
    { date: fellesferieStart, endDate: fellesferieEnd, name: 'Fellesferie' },
  ];
}

/**
 * Calendar events overlapping `[today, today + horizonDays]`, sorted by start date.
 * Covers public holidays, Oslo school holidays, Halloween, the four Advent Sundays and
 * fellesferie; season itself (grilling, strawberries, lutefisk and the like) is left to the
 * model's own knowledge of the date and is not enumerated here (T37).
 *
 * Oslo school holidays are approximate: the municipality sets exact dates each year and they can
 * shift by a few days. `sommerferie` in particular — Saturday of ISO week 25 to Sunday of week 33
 * — is the common pattern, not a fixed rule.
 */
export function calendarEvents(today: string, horizonDays = 21): CalendarEvent[] {
  const horizonEnd = addDays(today, horizonDays);
  const startYear = Number(today.slice(0, 4));

  const candidates = [
    ...yearEvents(startYear - 1),
    ...yearEvents(startYear),
    ...yearEvents(startYear + 1),
  ];

  return candidates
    .filter((event) => {
      const end = event.endDate ?? event.date;
      return diffDays(today, end) >= 0 && diffDays(event.date, horizonEnd) >= 0;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
