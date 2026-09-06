export type LlmPurpose = 'extract' | 'match';

export type JsonCompletionRequest = {
  purpose: LlmPurpose;
  system: string;
  userText: string;
  /** `data:image/jpeg;base64,...` */
  imageDataUrl?: string;
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
