import 'dotenv/config';
import pino from 'pino';
import { buildApp } from './app.ts';
import { loadConfig, type Config } from './config.ts';

const bootLogger = pino({ level: 'info' });

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  bootLogger.error({ err: error }, 'Invalid configuration');
  process.exit(1);
}

let app: ReturnType<typeof buildApp>;
try {
  app = buildApp({ config });
} catch (error) {
  bootLogger.error({ err: error }, 'Failed to build the app');
  process.exit(1);
}

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info(`Kvitteringer listening on ${address}`);
} catch (error) {
  app.log.error({ err: error }, 'Failed to start server');
  process.exit(1);
}

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  process.exit(0);
};

process.on('SIGTERM', (signal) => {
  void shutdown(signal);
});
