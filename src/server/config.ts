import { z } from 'zod';

const NODE_ENVS = ['development', 'production', 'test'] as const;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const KIMI_THINKING_MODES = ['enabled', 'disabled'] as const;
const LLM_PROVIDERS = ['kimi', 'grok'] as const;

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_PATH: z.string().min(1).default('./data/receipt-scanner.db'),
    APP_PASSWORD: z.string().min(8, 'APP_PASSWORD must be at least 8 characters long'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters long'),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('kimi'),
    // Explicit rather than the OpenAI SDK's own default (2): an unresponsive call retried twice on
    // top of the full timeout each time can block the queue for several times KIMI_TIMEOUT_MS.
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(0),
    MOONSHOT_API_KEY: z.string().optional(),
    KIMI_MODEL: z.string().min(1).default('kimi-k2.6'),
    KIMI_BASE_URL: z.url().default('https://api.moonshot.ai/v1'),
    KIMI_THINKING: z.enum(KIMI_THINKING_MODES).default('disabled'),
    KIMI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    XAI_API_KEY: z.string().optional(),
    XAI_MODEL: z.string().min(1).default('grok-4.6'),
    XAI_BASE_URL: z.url().default('https://api.x.ai/v1'),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    TZ: z.string().min(1).default('Europe/Oslo'),
    // env_file (docker-compose, Render) sets an empty-but-present LITESTREAM_BUCKET=
    // as "", not undefined, so an empty string must mean "not configured" too.
    LITESTREAM_BUCKET: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().min(1).optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.LLM_PROVIDER === 'kimi' && !data.MOONSHOT_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['MOONSHOT_API_KEY'],
        message: 'MOONSHOT_API_KEY is required when LLM_PROVIDER=kimi',
      });
    }
    if (data.LLM_PROVIDER === 'grok' && !data.XAI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['XAI_API_KEY'],
        message: 'XAI_API_KEY is required when LLM_PROVIDER=grok',
      });
    }
  });

export type NodeEnv = (typeof NODE_ENVS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type KimiThinking = (typeof KIMI_THINKING_MODES)[number];
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type Config = {
  nodeEnv: NodeEnv;
  port: number;
  host: string;
  databasePath: string;
  appPassword: string;
  sessionSecret: string;
  llmProvider: LlmProvider;
  llmMaxRetries: number;
  moonshotApiKey: string | undefined;
  kimiModel: string;
  kimiBaseUrl: string;
  kimiThinking: KimiThinking;
  kimiTimeoutMs: number;
  xaiApiKey: string | undefined;
  xaiModel: string;
  xaiBaseUrl: string;
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
    llmProvider: parsed.LLM_PROVIDER,
    llmMaxRetries: parsed.LLM_MAX_RETRIES,
    moonshotApiKey: parsed.MOONSHOT_API_KEY,
    kimiModel: parsed.KIMI_MODEL,
    kimiBaseUrl: parsed.KIMI_BASE_URL,
    kimiThinking: parsed.KIMI_THINKING,
    kimiTimeoutMs: parsed.KIMI_TIMEOUT_MS,
    xaiApiKey: parsed.XAI_API_KEY,
    xaiModel: parsed.XAI_MODEL,
    xaiBaseUrl: parsed.XAI_BASE_URL,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    logLevel: parsed.LOG_LEVEL,
    tz: parsed.TZ,
    litestreamBucket: parsed.LITESTREAM_BUCKET,
  };
}
