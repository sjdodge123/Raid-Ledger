/**
 * LLM output helpers — unit tests (TDD FAILING, ROK-931).
 *
 * Covers the parse + retry-once behavior required by spec AC line 254
 * ("LLM parse-fail retry path covered by unit test"). The helper
 * `callAndParseLlmOutput` must:
 *   1. Call `LlmService.chat` once and parse the JSON response.
 *   2. On parse failure, retry exactly once with a stricter prompt.
 *   3. After two failures, return an empty suggestions array (NOT throw).
 *
 * Implementation does not exist yet — these tests fail at module resolution
 * until Phase B lands `llm-output.helpers.ts`.
 */
import type { LlmService } from '../../ai/llm.service';
import { LlmQuotaExhaustedError } from '../../ai/llm-errors';
import type {
  LlmChatOptions,
  LlmChatResponse,
} from '../../ai/llm-provider.interface';
import {
  callAndParseLlmOutput,
  LlmUnavailableError,
} from './llm-output.helpers';

type MockLlmService = Pick<LlmService, 'chat'>;

function makeChatResponse(content: string): LlmChatResponse {
  return { content, latencyMs: 10 };
}

function makeMockLlmService(responses: (LlmChatResponse | Error)[]): {
  service: MockLlmService;
  chat: jest.Mock;
} {
  const chat = jest.fn<
    Promise<LlmChatResponse>,
    [LlmChatOptions, { feature: string }]
  >();
  for (const r of responses) {
    if (r instanceof Error) chat.mockRejectedValueOnce(r);
    else chat.mockResolvedValueOnce(r);
  }
  return { service: { chat }, chat };
}

const VALID_PAYLOAD = JSON.stringify({
  suggestions: [
    { gameId: 42, reasoning: 'Matches co-op taste' },
    { gameId: 43, reasoning: 'Shared RPG axis' },
  ],
});

describe('callAndParseLlmOutput (ROK-931)', () => {
  it('returns parsed suggestions when the first call produces valid JSON', async () => {
    const { service, chat } = makeMockLlmService([
      makeChatResponse(VALID_PAYLOAD),
    ]);
    const result = await callAndParseLlmOutput(service as LlmService, {
      messages: [{ role: 'user', content: 'suggest games' }],
    });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toEqual(
      expect.objectContaining({
        gameId: 42,
        reasoning: 'Matches co-op taste',
      }),
    );
  });

  it('retries exactly once with stricter prompt when first response is malformed', async () => {
    const { service, chat } = makeMockLlmService([
      makeChatResponse('not json at all'),
      makeChatResponse(VALID_PAYLOAD),
    ]);
    const result = await callAndParseLlmOutput(service as LlmService, {
      messages: [{ role: 'user', content: 'suggest games' }],
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.suggestions).toHaveLength(2);
    // Second call should be a stricter retry — messages should differ from
    // the first invocation (the dev may add a stricter system prompt or
    // reiterate the schema in the user message). Assert the retry is
    // distinguishable from the original call rather than asserting exact
    // wording — keeps the test robust to phrasing changes.
    const firstCall = chat.mock.calls[0][0];
    const secondCall = chat.mock.calls[1][0];
    expect(JSON.stringify(firstCall.messages)).not.toBe(
      JSON.stringify(secondCall.messages),
    );
  });

  it('returns empty suggestions array when both attempts fail to parse (does NOT throw)', async () => {
    const { service, chat } = makeMockLlmService([
      makeChatResponse('still not json'),
      makeChatResponse('{"malformed": true'),
    ]);
    const result = await callAndParseLlmOutput(service as LlmService, {
      messages: [{ role: 'user', content: 'suggest games' }],
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.suggestions).toEqual([]);
  });

  it('throws LlmUnavailableError when both attempts reject with provider errors (Gemini 5xx)', async () => {
    // Review coverage gap: as-built reconcile #3 says two consecutive
    // provider failures must throw LlmUnavailableError so the
    // controller can map to HTTP 503. Previously untested.
    const { service, chat } = makeMockLlmService([
      new Error('503 upstream high demand'),
      new Error('503 upstream high demand'),
    ]);
    await expect(
      callAndParseLlmOutput(service as LlmService, {
        messages: [{ role: 'user', content: 'suggest games' }],
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  // ROK-1376: quota exhaustion is permanent until billing resets — the
  // parse-retry would burn a second doomed provider call, so the typed
  // error must short-circuit the retry and reach the caller unwrapped.
  describe('quota exhaustion (ROK-1376)', () => {
    it('rethrows LlmQuotaExhaustedError from attempt 1 with NO retry call', async () => {
      const quota = new LlmQuotaExhaustedError(
        'Gemini: HTTP 429 — monthly spending cap exceeded',
        429,
      );
      const { service, chat } = makeMockLlmService([quota]);
      const caught = await callAndParseLlmOutput(service as LlmService, {
        messages: [{ role: 'user', content: 'suggest games' }],
      }).catch((e: unknown) => e);
      expect(caught).toBe(quota);
      expect(chat).toHaveBeenCalledTimes(1);
    });

    it('rethrows the typed error (NOT LlmUnavailableError) when the parse-retry hits the quota wall', async () => {
      const quota = new LlmQuotaExhaustedError(
        'Gemini: HTTP 429 — quota exceeded',
        429,
      );
      const { service, chat } = makeMockLlmService([
        makeChatResponse('not json at all'),
        quota,
      ]);
      const caught = await callAndParseLlmOutput(service as LlmService, {
        messages: [{ role: 'user', content: 'suggest games' }],
      }).catch((e: unknown) => e);
      expect(caught).toBe(quota);
      expect(caught).not.toBeInstanceOf(LlmUnavailableError);
      expect(chat).toHaveBeenCalledTimes(2);
    });
  });

  it('recovers with parsed output when the first call errors and the retry succeeds', async () => {
    // Review coverage gap: the retry path must handle a provider error
    // on attempt 1 by retrying and consuming a valid payload on attempt
    // 2 — exercised neither by the parse-retry test (error-then-ok) nor
    // by the double-error test above.
    const { service, chat } = makeMockLlmService([
      new Error('upstream 500'),
      makeChatResponse(VALID_PAYLOAD),
    ]);
    const result = await callAndParseLlmOutput(service as LlmService, {
      messages: [{ role: 'user', content: 'suggest games' }],
    });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(result.suggestions).toHaveLength(2);
  });
});
