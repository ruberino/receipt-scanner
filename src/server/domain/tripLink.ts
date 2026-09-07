import { diffDays, todayInOslo } from '../../shared/dates.ts';

export type TripListCandidate = { id: number; completedAt: string };

/**
 * The automatic receipt-to-list linking rule (T39, ADR-0018): a candidate list qualifies when its
 * completion day and the receipt's purchase date (both civil dates in Europe/Oslo, ADR-0007) are
 * at most one day apart. Among qualifying candidates the closest wins; a tie goes to the most
 * recently completed. Pure: candidates are whatever the caller already loaded.
 */
export function findTripList(purchaseDate: string, candidates: TripListCandidate[]): number | null {
  let best: { id: number; distance: number; completedAt: string } | null = null;

  for (const candidate of candidates) {
    const completionDay = todayInOslo(new Date(candidate.completedAt));
    const distance = Math.abs(diffDays(purchaseDate, completionDay));
    if (distance > 1) {
      continue;
    }
    if (
      best === null ||
      distance < best.distance ||
      (distance === best.distance && candidate.completedAt > best.completedAt)
    ) {
      best = { id: candidate.id, distance, completedAt: candidate.completedAt };
    }
  }

  return best?.id ?? null;
}
