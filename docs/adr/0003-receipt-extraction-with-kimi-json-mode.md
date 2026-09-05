# ADR-0003: Receipt extraction with Kimi (Moonshot AI) through the OpenAI-compatible API in JSON mode

- Status: Accepted
- Date: 2026-09-05

## Context

Extracting store, date, total and line items from a photo of a Norwegian grocery receipt is a vision task with a structured result.
Classic OCR plus regex parsing breaks on every store layout and on folded or crumpled paper.
The household already pays for and uses Kimi (Moonshot AI) in `sissel` and `shopper` through the OpenAI-compatible endpoint, and the user chose Kimi for this app.
Verified facts from the Moonshot platform documentation on 2026-09-05:

- Base URL `https://api.moonshot.ai/v1`, OpenAI-compatible chat completions.
- `kimi-k2.6` accepts text and image input; images should be at most 4K resolution and are sent as `image_url` with a base64 data URL.
- JSON mode is `response_format: { type: 'json_object' }`; the prompt must describe the fields and give an example; the model outputs a JSON object, never a bare array; a `finish_reason` of `length` means the JSON is truncated.
- `kimi-k2.6` has a `thinking` parameter, `{ type: 'enabled' | 'disabled' }`, default enabled, and a fixed temperature per mode; other temperatures are rejected.
- Published price for `kimi-k2.6`: 0.95 USD per million input tokens, 0.16 USD cached, 4.00 USD per million output tokens, 262 144 token context.

Not verified at the time of writing: that `response_format: json_object` is accepted on the same request as an image part; the documentation describes the two features separately.
The first implementation task that touches the API (T05) checks this with one manual request.
If the combination is rejected, the fallback is to omit `response_format`, keep the JSON instructions in the prompt, and rely on our own JSON parsing, which already tolerates code fences.

## Decision

- Extraction is one chat completion per receipt: a system prompt describing Norwegian receipt conventions and the exact output schema with an example, plus a user message containing the receipt image as a base64 JPEG data URL and a short instruction.
- `response_format: { type: 'json_object' }`, `max_tokens: 6000`, no `temperature`, `thinking: { type: KIMI_THINKING }` with default `disabled`.
- The output is parsed with `JSON.parse` and validated with a zod schema that accepts numbers or decimal-comma strings for amounts; anything else fails the job with a stored raw response.
- The model id, base URL, thinking mode and timeout are configuration, not code; the defaults are `kimi-k2.6`, `https://api.moonshot.ai/v1`, `disabled`, 120 s.
- The `openai` SDK is used as the HTTP client with `maxRetries: 2`; the Moonshot-specific `thinking` field is passed as an extra body property.
- Every prompt has a `PROMPT_VERSION` constant stored on the receipt together with the model name, so results can be compared across changes.
- Prompt or model changes must be run through the extraction eval set before merging (ADR-0014).
- Receipt images and text leave the household to Moonshot AI; this is accepted for a personal tool and documented in `architecture.md` section 11.

## Consequences

- No OCR library, no per-store parsers; new store layouts usually work without code changes.
- One external dependency in the hot path; failures are surfaced as a failed receipt with a retry button, never as a crash.
- Cost is roughly 0.1–0.2 NOK per receipt, negligible at one receipt a week.
- The provider can be swapped by implementing the `LlmClient` interface; the prompts assume a vision model with JSON mode.
- Without `json_schema` support in the documented API, strict schema enforcement happens on our side with zod; malformed output is a failed job, not a corrupted receipt.

## Alternatives considered

- Anthropic Claude with structured outputs: strong fit, but the user chose Kimi and it keeps one provider across the household apps.
- Multi-provider abstraction like `shopper`: more code and test surface; the `LlmClient` interface leaves the door open without building it now.
- Tesseract OCR plus parsing rules: brittle across store layouts and photo quality.
- Store apps or e-receipts: not available across all stores the household uses.
