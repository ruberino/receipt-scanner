import { z } from 'zod';

// T22 CI red-check drill: deliberate unused variable, reverted in the next commit.
const ciRedCheckDrill = 'unused';

const NODE_ENVS = ['development', 'production', 'test'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const KIMI_THINKING_MODES = ['enabled', 'disabled'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_PATH: z.string().min(1).default('./data/receipt-scanner.db'),
  APP_PASSWORD: z.string().min(8, 'APP_PASSWORD must be at least 8 characters long'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters long'),
  MOONSHOT_API_KEY: z.string().min(1, 'MOONSHOT_API_KEY is required'),
  KIMI_MODEL: z.string().min(1).default('kimi-k2.6'),
  KIMI_BASE_URL: z.url().default('https://api.moonshot.ai/v1'),
  KIMI_THINKING: z.enum(KIMI_THINKING_MODES).default('disabled'),
  KIMI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  TZ: z.string().min(1).default('Europe/Oslo'),
  // env_file (docker-compose, Render) sets an empty-but-present LITESTREAM_BUCKET=
  // as "", not undefined, so an empty string must mean "not configured" too.
  LITESTREAM_BUCKET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
});

export type NodeEnv = (typeof NODE_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type KimiThinking = (typeof KIMI_THINKING_MODES)[number];

export type Config = {
  nodeEnv: NodeEnv;
  port: number;
  host: string;
  databasePath: string;
  appPassword: string;
  sessionSecret: string;
  moonshotApiKey: string;
  kimiModel: string;
  kimiBaseUrl: string;
  kimiThinking: KimiThinking;
  kimiTimeoutMs: number;
  maxUploadBytes: number;
  logLevel: LogLevel;
  tz: string;
  litestreamBucket: string | undefined;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid configuration: ${message}`);
  }

  const parsed = result.data;
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    databasePath: parsed.DATABASE_PATH,
    appPassword: parsed.APP_PASSWORD,
    sessionSecret: parsed.SESSION_SECRET,
    moonshotApiKey: parsed.MOONSHOT_API_KEY,
    kimiModel: parsed.KIMI_MODEL,
    kimiBaseUrl: parsed.KIMI_BASE_URL,
    kimiThinking: parsed.KIMI_THINKING,
    kimiTimeoutMs: parsed.KIMI_TIMEOUT_MS,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    logLevel: parsed.LOG_LEVEL,
    tz: parsed.TZ,
    litestreamBucket: parsed.LITESTREAM_BUCKET,
  };
}
