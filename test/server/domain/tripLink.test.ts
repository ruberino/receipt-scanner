import { describe, expect, it } from 'vitest';
import { findTripList } from '../../../src/server/domain/tripLink.ts';

describe('findTripList', () => {
  it('links a receipt purchased the same day as completion', () => {
    const id = findTripList('2026-09-06', [{ id: 1, completedAt: '2026-09-06T18:00:00.000Z' }]);

    expect(id).toBe(1);
  });

  it('links a receipt purchased the day before completion (forgot to press Ferdig handlet until the next morning)', () => {
    const id = findTripList('2026-09-05', [{ id: 1, completedAt: '2026-09-06T08:00:00.000Z' }]);

    expect(id).toBe(1);
  });

  it('links a receipt purchased the day after completion (a second shop for the same list)', () => {
    const id = findTripList('2026-09-07', [{ id: 1, completedAt: '2026-09-06T18:00:00.000Z' }]);

    expect(id).toBe(1);
  });

  it('does not link a receipt two days apart', () => {
    const id = findTripList('2026-09-08', [{ id: 1, completedAt: '2026-09-06T18:00:00.000Z' }]);

    expect(id).toBeNull();
  });

  it('returns null when there are no candidates', () => {
    expect(findTripList('2026-09-06', [])).toBeNull();
  });

  it('picks the closest candidate among several', () => {
    const id = findTripList('2026-09-06', [
      { id: 1, completedAt: '2026-09-04T18:00:00.000Z' }, // distance 2, does not qualify
      { id: 2, completedAt: '2026-09-07T18:00:00.000Z' }, // distance 1
      { id: 3, completedAt: '2026-09-06T09:00:00.000Z' }, // distance 0
    ]);

    expect(id).toBe(3);
  });

  it('picks the most recently completed candidate on a distance tie', () => {
    const id = findTripList('2026-09-06', [
      { id: 1, completedAt: '2026-09-05T09:00:00.000Z' }, // distance 1
      { id: 2, completedAt: '2026-09-07T09:00:00.000Z' }, // distance 1, completed later
    ]);

    expect(id).toBe(2);
  });

  it('treats a completion at 23:30 Oslo time on the 6th as the 6th, not the 7th (the UTC pitfall ADR-0007 exists for)', () => {
    // 2026-09-06T21:30:00Z is 2026-09-06T23:30 CEST (Oslo is UTC+2 in September): still the 6th
    // in Oslo. A receipt purchased on the 8th is then two days away and must not qualify — it
    // would wrongly qualify (distance 1) if the completion day were miscomputed as the 7th.
    const id = findTripList('2026-09-08', [{ id: 1, completedAt: '2026-09-06T21:30:00.000Z' }]);

    expect(id).toBeNull();
  });
});
