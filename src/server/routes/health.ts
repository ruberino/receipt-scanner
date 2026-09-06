import type { FastifyInstance } from 'fastify';

export type HealthRouteOptions = {
  version: string;
};

export default async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  // Never calls Kimi (ADR-0011); queueLength is wired to the job runner in T08.
  app.get('/api/health', async () => ({ status: 'ok', version: options.version, queueLength: 0 }));
}
