# Review follow-up: T05 — Kvitteringer

Review of commit `adf94dc` (T05) on `task/T05-llm-client`, 2026-09-06.
Verdict: approved for fast-forward merge after F1.

## What was verified

All five scripts exit 0 on the branch; 119 tests pass; `openai` is imported only by `src/server/llm/KimiClient.ts`.
`LlmClient.ts` matches the task's types exactly.
`buildRequestBody` puts the system message first and the image part before the text part, sets `response_format: { type: 'json_object' }`, `max_tokens` and `thinking.type`, and sets no `temperature`; four tests cover it.
`KimiClient` builds the SDK client with the configured timeout and `maxRetries: 2`, logs the ADR-0012 line with all eight fields, and maps SDK failures to `ExtractionError` with the section 7.3 message and the stage derived from `purpose`, keeping the original error as `cause`.
`FakeLlmClient` returns scripted results in order, supports function entries, records requests and fails clearly when exhausted; five tests.
`parseJsonObject` strips fences, rejects arrays, `null` and invalid JSON, and throws the documented Norwegian message with the stage; six tests.
`buildApp` takes `llmClient`, builds a `KimiClient` from config otherwise and decorates `app.llm`; `createTestApp` injects `FakeLlmClient([])`.
The step 0 check against `kimi-k2.6` (image part plus `response_format: json_object`, `thinking: disabled`) returned 200 with well-formed JSON and `finish_reason: stop`; the key was used once in `curl` and never written down.

## F1 — Required before merge: make `completeJson` testable, then test the log line and the error mapping

The ADR-0012 `info` line is the only record of what every LLM call cost and returned, and the error mapping is what turns a Kimi outage into the Norwegian message on the receipt.
Neither has a test, because the class constructs `OpenAI` itself.

Steps:

1. Add an optional `client?: Pick<OpenAI, 'chat'>` to `KimiClientOptions`; when given, use it instead of constructing one.
   Production code in `app.ts` stays unchanged.
2. Test in `test/server/llm/KimiClient.test.ts` with a stub whose `chat.completions.create` resolves to a minimal response (`choices[0].message.content`, `finish_reason`, `model`, `usage`): the result has `text`, `finishReason`, `model`, `usage` and a numeric `durationMs`, and the logger received exactly one `info` call whose object has `purpose`, `receiptId`, `model`, `promptVersion`, `promptTokens`, `completionTokens`, `durationMs` and `finishReason`.
3. Test the failure path with a stub that rejects: the promise rejects with an `ExtractionError` whose `userMessage` is `Lesetjenesten er utilgjengelig, prøv igjen senere`, whose `stage` is `extraction` for `purpose: 'extract'` and `matching` for `purpose: 'match'`, and whose `cause` is the stub's error.
4. Test that a response with no `choices` yields `text: ''` and `finishReason: 'unknown'` rather than a crash.

Acceptance: the tests pass without network, and `grep -n "new OpenAI" src/server/llm/KimiClient.ts` still prints exactly one line.

## Note for T07

`finish_reason === 'length'` maps to `Kvitteringen var for lang til å leses` in section 7.3; `completeJson` returns `finishReason` so that `parseExtraction` in T07 owns that check.

## Done

F1 on the T05 branch as a `test:` or `refactor:` commit, then fast-forward merge and send the hash.
