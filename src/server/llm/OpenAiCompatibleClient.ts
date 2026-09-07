import OpenAI from 'openai';
import type { Config, KimiThinking, LlmProvider } from '../config.ts';
import { ExtractionError, type ExtractionStage } from '../lib/errors.ts';
import type { JsonCompletionRequest, JsonCompletionResult, LlmClient } from './LlmClient.ts';

export type MinimalLogger = {
  info(details: Record<string, unknown>, message?: string): void;
};

export type OpenAiCompatibleClientOptions = {
  provider: LlmProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  /** Moonshot-specific; only sent on the request body when `provider` is `kimi` (ADR-0015). */
  thinking?: KimiThinking;
  timeoutMs: number;
  /** Explicit, not the OpenAI SDK's own default of 2: one unresponsive call retried twice on top
   * of the full timeout each time can block the queue for several times `timeoutMs`. */
  maxRetries: number;
  logger: MinimalLogger;
  /** Overrides the OpenAI SDK client; tests pass a stub so `completeJson` runs without network. */
  client?: Pick<OpenAI, 'chat'>;
};

type ContentPart =
  { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };

export type OpenAiCompatibleRequestBody = {
  model: string;
  messages: [{ role: 'system'; content: string }, { role: 'user'; content: ContentPart[] }];
  response_format: { type: 'json_object' };
  max_tokens: number;
  thinking?: { type: KimiThinking };
};

/** Builds the exact request body sent to the provider, so it can be unit tested without a network
 * call (ADR-0003, ADR-0015). The `thinking` field is Moonshot-specific and only sent for Kimi. */
export function buildRequestBody(
  request: JsonCompletionRequest,
  options: { provider: LlmProvider; model: string; thinking?: KimiThinking },
): OpenAiCompatibleRequestBody {
  const content: ContentPart[] = [];
  if (request.imageDataUrl) {
    content.push({ type: 'image_url', image_url: { url: request.imageDataUrl } });
  }
  content.push({ type: 'text', text: request.userText });

  const body: OpenAiCompatibleRequestBody = {
    model: options.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
    max_tokens: request.maxTokens,
  };
  if (options.provider === 'kimi') {
    body.thinking = { type: options.thinking ?? 'disabled' };
  }
  return body;
}

function stageFor(purpose: JsonCompletionRequest['purpose']): ExtractionStage {
  return purpose === 'extract' ? 'extraction' : 'matching';
}

/** `LlmClient` implementation for Kimi (Moonshot AI) or Grok (xAI), both OpenAI-compatible
 * chat-completions APIs (ADR-0003, ADR-0015). */
export class OpenAiCompatibleClient implements LlmClient {
  private readonly client: Pick<OpenAI, 'chat'>;
  /** Public so `createLlmClient`'s choice of provider/model is directly testable. */
  readonly provider: LlmProvider;
  readonly model: string;
  private readonly thinking: KimiThinking | undefined;
  private readonly logger: MinimalLogger;

  constructor(options: OpenAiCompatibleClientOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        timeout: options.timeoutMs,
        maxRetries: options.maxRetries,
      });
    this.provider = options.provider;
    this.model = options.model;
    this.thinking = options.thinking;
    this.logger = options.logger;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const body = buildRequestBody(request, {
      provider: this.provider,
      model: this.model,
      thinking: this.thinking,
    });
    const startedAt = Date.now();

    let response;
    try {
      // The `thinking` field is Moonshot-specific and not part of the OpenAI SDK's own types.
      response = await this.client.chat.completions.create(
        body as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming,
      );
    } catch (error) {
      throw new ExtractionError(
        'Lesetjenesten er utilgjengelig, prøv igjen senere',
        stageFor(request.purpose),
        {
          cause: error,
        },
      );
    }

    const durationMs = Date.now() - startedAt;
    const choice = response.choices[0];
    const text = choice?.message.content ?? '';
    const finishReason = choice?.finish_reason ?? 'unknown';
    const usage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
    };

    this.logger.info(
      {
        purpose: request.purpose,
        receiptId: request.receiptId,
        model: response.model,
        promptVersion: request.promptVersion,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        durationMs,
        finishReason,
      },
      'LLM call completed',
    );

    return { text, finishReason, model: response.model, usage, durationMs };
  }
}

/** Which model is live, from `Config` alone — the same choice `createLlmClient` makes, without
 * constructing a client. Used by `GET /api/health` (ADR-0015). */
export function activeModel(config: Config): string {
  return config.llmProvider === 'grok' ? config.xaiModel : config.kimiModel;
}

/** One factory for `app.ts` and `eval/run.ts`, so the two never drift on how a `Config` becomes an
 * `LlmClient` (ADR-0015). `loadConfig()` already guarantees the active provider's key is present. */
export function createLlmClient(config: Config, logger: MinimalLogger): LlmClient {
  if (config.llmProvider === 'grok') {
    return new OpenAiCompatibleClient({
      provider: 'grok',
      apiKey: config.xaiApiKey!,
      baseURL: config.xaiBaseUrl,
      model: config.xaiModel,
      timeoutMs: config.kimiTimeoutMs,
      maxRetries: config.llmMaxRetries,
      logger,
    });
  }

  return new OpenAiCompatibleClient({
    provider: 'kimi',
    apiKey: config.moonshotApiKey!,
    baseURL: config.kimiBaseUrl,
    model: config.kimiModel,
    thinking: config.kimiThinking,
    timeoutMs: config.kimiTimeoutMs,
    maxRetries: config.llmMaxRetries,
    logger,
  });
}
