import OpenAI from 'openai';
import type { Config, KimiThinking, LlmProvider } from '../config.ts';
import { ExtractionError, type ExtractionStage } from '../lib/errors.ts';
import type { JsonCompletionRequest, JsonCompletionResult, LlmClient } from './LlmClient.ts';
import { PurposeRoutingLlmClient } from './PurposeRoutingLlmClient.ts';

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
  const content: ContentPart[] = (request.imageDataUrls ?? []).map((url) => ({
    type: 'image_url' as const,
    image_url: { url },
  }));
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
  if (purpose === 'extract') {
    return 'extraction';
  }
  if (purpose === 'match') {
    return 'matching';
  }
  return 'proposal';
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
        listId: request.listId,
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

function modelFor(provider: LlmProvider, config: Config): string {
  return provider === 'grok' ? config.xaiModel : config.kimiModel;
}

/** Which models are live, from `Config` alone — the same choices `createLlmClient` makes, without
 * constructing a client. Used by `GET /api/health` (ADR-0015, ADR-0017). `model` is the extraction
 * and matching provider's, kept under its original name for compatibility; `proposalModel` is the
 * `purpose: 'propose'` provider's, the same when `LLM_PROVIDER_PROPOSE` is unset. */
export function activeModels(config: Config): { model: string; proposalModel: string } {
  return {
    model: modelFor(config.llmProvider, config),
    proposalModel: modelFor(config.llmProviderPropose, config),
  };
}

/** One provider's client, same options regardless of which purpose reaches it (ADR-0015). */
function buildProviderClient(
  provider: LlmProvider,
  config: Config,
  logger: MinimalLogger,
): OpenAiCompatibleClient {
  if (provider === 'grok') {
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

/** One factory for `app.ts` and `eval/run.ts`, so neither builds a client by hand (ADR-0015).
 * Routes `purpose: 'propose'` to `config.llmProviderPropose` and everything else to
 * `config.llmProvider` (ADR-0017), below the `LlmClient` interface so no caller knows; one
 * `OpenAiCompatibleClient` per distinct provider in use, shared when both purposes agree.
 * `loadConfig()` already guarantees every provider in use has its key present. */
export function createLlmClient(config: Config, logger: MinimalLogger): LlmClient {
  const clientsByProvider = new Map<LlmProvider, OpenAiCompatibleClient>();
  function clientFor(provider: LlmProvider): OpenAiCompatibleClient {
    const existing = clientsByProvider.get(provider);
    if (existing) {
      return existing;
    }
    const created = buildProviderClient(provider, config, logger);
    clientsByProvider.set(provider, created);
    return created;
  }

  return new PurposeRoutingLlmClient({
    fallback: clientFor(config.llmProvider),
    byPurpose: { propose: clientFor(config.llmProviderPropose) },
  });
}
