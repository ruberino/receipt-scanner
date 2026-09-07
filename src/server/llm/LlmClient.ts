export type LlmPurpose = 'extract' | 'match';

export type JsonCompletionRequest = {
  purpose: LlmPurpose;
  system: string;
  userText: string;
  /** `data:image/jpeg;base64,...`, one per consecutive top-to-bottom segment of a tall receipt
   * (T28); sent as consecutive `image_url` parts in the order given. */
  imageDataUrls?: string[];
  maxTokens: number;
  promptVersion: number;
  receiptId?: number;
};

export type JsonCompletionResult = {
  text: string;
  finishReason: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  durationMs: number;
};

export interface LlmClient {
  completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult>;
}
