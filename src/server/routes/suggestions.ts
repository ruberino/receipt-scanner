import type { FastifyInstance } from 'fastify';
import { todayInOslo } from '../../shared/dates.ts';
import { computeSuggestions } from '../domain/suggestions.ts';
import { loadProductHistories } from '../domain/productStats.ts';

export type SuggestionsRouteOptions = {
  /** Same clock the receipts routes get, so `todayInOslo` is deterministic in tests. */
  now: () => Date;
};

export default async function suggestionsRoutes(
  app: FastifyInstance,
  options: SuggestionsRouteOptions,
): Promise<void> {
  app.get('/api/suggestions', async () => {
    const histories = loadProductHistories(app.db);
    return computeSuggestions(histories, todayInOslo(options.now()));
  });
}
