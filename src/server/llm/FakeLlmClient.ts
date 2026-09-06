import type { JsonCompletionRequest, JsonCompletionResult, LlmClient } from './LlmClient.ts';

export type ScriptedResult =
  JsonCompletionResult | ((request: JsonCompletionRequest) => JsonCompletionResult);

/** Test double for `LlmClient`: returns scripted results in order and records every request it received. */
export class FakeLlmClient implements LlmClient {
  readonly requests: JsonCompletionRequest[] = [];
  private readonly script: ScriptedResult[];
  private cursor = 0;

  constructor(script: ScriptedResult[]) {
    this.script = script;
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    this.requests.push(request);

    const entry = this.script[this.cursor];
    if (entry === undefined) {
      throw new Error(
        `FakeLlmClient: no scripted response left for request ${this.cursor + 1} (purpose="${request.purpose}"); scripted ${this.script.length} response(s).`,
      );
    }
    this.cursor += 1;

    return typeof entry === 'function' ? entry(request) : entry;
  }
}
