import type { FastifyInstance } from 'fastify';

export type HealthRouteOptions = {
  version: string;
};

export default async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  // Never calls Kimi (ADR-0011).
  app.get('/api/health', async () => ({
    status: 'ok',
    version: options.version,
    queueLength: app.receiptProcessor.queueLength(),
  }));
}
