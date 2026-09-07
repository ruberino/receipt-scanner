import { describe, expect, it } from 'vitest';
import { calendarEvents } from '../../src/shared/calendar.ts';

function names(events: ReturnType<typeof calendarEvents>): string[] {
  return events.map((event) => event.name);
}

function find(events: ReturnType<typeof calendarEvents>, name: string) {
  return events.find((event) => event.name === name);
}

describe('calendarEvents', () => {
  it('places Easter 2026 on 5 April and 2027 on 28 March (Anonymous Gregorian algorithm)', () => {
    const events2026 = calendarEvents('2026-03-20', 30);
    expect(find(events2026, '1. påskedag')?.date).toBe('2026-04-05');

    const events2027 = calendarEvents('2027-03-10', 30);
    expect(find(events2027, '1. påskedag')?.date).toBe('2027-03-28');
  });

  it('derives the other Easter-relative holidays from Easter Sunday', () => {
    const events = calendarEvents('2026-03-20', 90);

    expect(find(events, 'Skjærtorsdag')?.date).toBe('2026-04-02');
    expect(find(events, 'Langfredag')?.date).toBe('2026-04-03');
    expect(find(events, '2. påskedag')?.date).toBe('2026-04-06');
    expect(find(events, 'Kristi himmelfartsdag')?.date).toBe('2026-05-14');
    expect(find(events, '1. pinsedag')?.date).toBe('2026-05-24');
    expect(find(events, '2. pinsedag')?.date).toBe('2026-05-25');
  });

  it('includes Halloween when it falls inside the default 21-day horizon, not outside it', () => {
    expect(names(calendarEvents('2026-10-15'))).toContain('Halloween');
    expect(names(calendarEvents('2026-09-07'))).not.toContain('Halloween');
  });

  it('places høstferie 2026 (Oslo, ISO week 40) on 28 September to 4 October', () => {
    const events = calendarEvents('2026-09-01', 60);

    expect(find(events, 'Høstferie (Oslo)')).toMatchObject({
      date: '2026-09-28',
      endDate: '2026-10-04',
    });
  });

  it('places the four Advent Sundays before Christmas, most recent last', () => {
    const events = calendarEvents('2026-11-20', 60);

    expect(find(events, '1. søndag i advent')?.date).toBe('2026-11-29');
    expect(find(events, '2. søndag i advent')?.date).toBe('2026-12-06');
    expect(find(events, '3. søndag i advent')?.date).toBe('2026-12-13');
    expect(find(events, '4. søndag i advent')?.date).toBe('2026-12-20');
  });

  it('spans juleferie across the year boundary and still finds nyttårsdag the next year', () => {
    const events = calendarEvents('2026-12-28', 10);

    expect(find(events, 'Juleferie (Oslo)')).toMatchObject({
      date: '2026-12-21',
      endDate: '2027-01-01',
    });
    expect(find(events, 'Nyttårsdag')?.date).toBe('2027-01-01');
  });

  it('places fellesferie across ISO weeks 28 to 30', () => {
    const events = calendarEvents('2026-07-01', 60);

    const fellesferie = find(events, 'Fellesferie');
    expect(fellesferie?.date).toBe('2026-07-06');
    expect(fellesferie?.endDate).toBe('2026-07-26');
  });

  it('includes a multi-day event that started before today but has not ended yet', () => {
    const events = calendarEvents('2026-07-15', 5);

    expect(names(events)).toContain('Fellesferie');
  });

  it('sorts events by start date', () => {
    const events = calendarEvents('2026-12-01', 40);
    const dates = events.map((event) => event.date);

    expect(dates).toEqual([...dates].sort());
  });
});
