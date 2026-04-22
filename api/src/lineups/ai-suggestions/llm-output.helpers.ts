import type { AiSuggestionsLlmOutputDto } from '@raid-ledger/contract';
import { AiSuggestionsLlmOutputSchema } from '@raid-ledger/contract';
import type { LlmService } from '../../ai/llm.service';
import type {
  LlmChatMessage,
  LlmChatOptions,
  LlmRequestContext,
} from '../../ai/llm-provider.interface';

/** Feature tag for AI-suggestions LLM requests (surfaces in ai_request_logs). */
export const LLM_FEATURE_TAG = 'lineup_ai_suggestions';

const RETRY_REMINDER =
  'Your previous response was not valid JSON matching the required schema. ' +
  'Respond ONLY with a single JSON object of the form ' +
  '{"suggestions":[{"gameId":<int>,"reasoning":"..."}]} — ' +
  'no prose, no code fences, no extra keys (confidence is derived server-side from output order).';

/**
 * Extract a JSON object from LLM text output.
 *
 * Providers sometimes wrap JSON in ``` fences or include a preamble. We
 * grab the first `{...}` block and attempt to parse it. Returns null on
 * any parse failure so callers can decide whether to retry.
 */
function extractJson(content: string): unknown {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  const slice = content.slice(start, end + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return null;
  }
}

/**
 * Try to parse a single chat response as a well-formed
 * `AiSuggestionsLlmOutputDto`. Returns null on any failure — the caller
 * decides whether this was attempt 1 (retry) or attempt 2 (give up).
 */
function parseOnce(content: string): AiSuggestionsLlmOutputDto | null {
  const raw = extractJson(content);
  if (raw === null) return null;
  const parsed = AiSuggestionsLlmOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function buildRetryOptions(original: LlmChatOptions): LlmChatOptions {
  const reminder: LlmChatMessage = { role: 'system', content: RETRY_REMINDER };
  return {
    ...original,
    messages: [...original.messages, reminder],
  };
}

/**
 * Error shape surfaced when both LLM attempts failed for reasons the
 * controller should translate to 503 (provider unreachable, rate
 * limited, transient upstream 5xx). Parse failures don't throw — they
 * resolve to `{ suggestions: [] }` so the cache layer can anchor a
 * shorter TTL and the UI hides the section silently.
 */
export class LlmUnavailableError extends Error {
  readonly name = 'LlmUnavailableError';
}

async function tryChat(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext,
): Promise<
  AiSuggestionsLlmOutputDto | { parseFail: true } | { unavailable: Error }
> {
  try {
    const response = await llmService.chat(options, context);
    const parsed = parseOnce(response.content);
    if (parsed) return parsed;
    return { parseFail: true };
  } catch (err) {
    return { unavailable: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Call `LlmService.chat`, parse JSON, retry once on EITHER a parse
 * failure OR a transient provider error (Gemini 5xx, rate limit,
 * timeout). After two attempts:
 *   - both parse-failed → return `{ suggestions: [] }` (UI hides)
 *   - last attempt failed with provider error → throw `LlmUnavailableError`
 *     so the controller maps it to 503
 * Config-level failures (no provider registered) still propagate
 * untouched via `NotFoundException` from `LlmService.resolveOrThrow`.
 */
export async function callAndParseLlmOutput(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext = { feature: LLM_FEATURE_TAG },
): Promise<AiSuggestionsLlmOutputDto> {
  const first = await tryChat(llmService, options, context);
  if ('suggestions' in first) return first;

  const retryOpts = buildRetryOptions(options);
  const second = await tryChat(llmService, retryOpts, context);
  if ('suggestions' in second) return second;

  if ('unavailable' in second) {
    throw new LlmUnavailableError(second.unavailable.message);
  }
  return { suggestions: [] };
}
