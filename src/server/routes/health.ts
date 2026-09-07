import type { FastifyInstance } from 'fastify';

export type HealthRouteOptions = {
  version: string;
  replicationEnabled: boolean;
  /** The active provider's model name (ADR-0015), so an operator can see which one is live. */
  model: string;
};

export default async function healthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  // Never calls the LLM (ADR-0011).
  app.get('/api/health', async () => ({
    status: 'ok',
    version: options.version,
    queueLength: app.receiptProcessor.queueLength(),
    replication: options.replicationEnabled ? 'on' : 'off',
    model: options.model,
  }));
}
