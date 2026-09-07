import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  LlmPurpose,
} from './LlmClient.ts';

export type PurposeRoutingLlmClientOptions = {
  fallback: LlmClient;
  byPurpose: Partial<Record<LlmPurpose, LlmClient>>;
};

/**
 * Routes a request to the `LlmClient` chosen for its `purpose`, falling back to the default
 * provider for every purpose that has no override (ADR-0017). Lives below the `LlmClient`
 * interface, so nothing above it — the extraction pipeline, matching, the proposal call, the
 * routes, `eval/run.ts` — knows or cares that two providers might be involved.
 */
export class PurposeRoutingLlmClient implements LlmClient {
  private readonly fallback: LlmClient;
  private readonly byPurpose: Partial<Record<LlmPurpose, LlmClient>>;

  constructor(options: PurposeRoutingLlmClientOptions) {
    this.fallback = options.fallback;
    this.byPurpose = options.byPurpose;
  }

  /** Public so a caller (`createLlmClient`'s own tests) can read `provider`/`model` off the
   * `OpenAiCompatibleClient` a given purpose actually reaches. */
  clientFor(purpose: LlmPurpose): LlmClient {
    return this.byPurpose[purpose] ?? this.fallback;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    return this.clientFor(request.purpose).completeJson(request);
  }
}
