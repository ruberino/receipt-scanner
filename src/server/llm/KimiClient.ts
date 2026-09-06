import OpenAI from 'openai';
import type { KimiThinking } from '../config.ts';
import { ExtractionError, type ExtractionStage } from '../lib/errors.ts';
import type { JsonCompletionRequest, JsonCompletionResult, LlmClient } from './LlmClient.ts';

export type MinimalLogger = {
  info(details: Record<string, unknown>, message?: string): void;
};

export type KimiClientOptions = {
  apiKey: string;
  baseURL: string;
  model: string;
  thinking: KimiThinking;
  timeoutMs: number;
  logger: MinimalLogger;
  /** Overrides the OpenAI SDK client; tests pass a stub so `completeJson` runs without network. */
  client?: Pick<OpenAI, 'chat'>;
};

type KimiContentPart =
  { type: 'image_url'; image_url: { url: string } } | { type: 'text'; text: string };

export type KimiRequestBody = {
  model: string;
  messages: [{ role: 'system'; content: string }, { role: 'user'; content: KimiContentPart[] }];
  response_format: { type: 'json_object' };
  max_tokens: number;
  thinking: { type: KimiThinking };
};

/** Builds the exact request body sent to Kimi, so it can be unit tested without a network call (ADR-0003). */
export function buildRequestBody(
  request: JsonCompletionRequest,
  options: { model: string; thinking: KimiThinking },
): KimiRequestBody {
  const content: KimiContentPart[] = [];
  if (request.imageDataUrl) {
    content.push({ type: 'image_url', image_url: { url: request.imageDataUrl } });
  }
  content.push({ type: 'text', text: request.userText });

  return {
    model: options.model,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
    max_tokens: request.maxTokens,
    thinking: { type: options.thinking },
  };
}

function stageFor(purpose: JsonCompletionRequest['purpose']): ExtractionStage {
  return purpose === 'extract' ? 'extraction' : 'matching';
}

/** `LlmClient` implementation for Kimi (Moonshot AI) through the OpenAI-compatible API (ADR-0003). */
export class KimiClient implements LlmClient {
  private readonly client: Pick<OpenAI, 'chat'>;
  private readonly model: string;
  private readonly thinking: KimiThinking;
  private readonly logger: MinimalLogger;

  constructor(options: KimiClientOptions) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        timeout: options.timeoutMs,
        maxRetries: 2,
      });
    this.model = options.model;
    this.thinking = options.thinking;
    this.logger = options.logger;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const body = buildRequestBody(request, { model: this.model, thinking: this.thinking });
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
