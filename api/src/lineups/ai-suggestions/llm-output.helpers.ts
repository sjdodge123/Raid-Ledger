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
  '{"suggestions":[{"gameId":<int>,"confidence":<0..1>,"reasoning":"..."}]} — ' +
  'no prose, no code fences, no extra keys.';

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
 * Call `LlmService.chat`, parse JSON, retry once with a stricter prompt
 * on parse failure. Returns an empty suggestions array (NOT throws) if
 * both attempts fail to produce parseable output — callers cache the
 * empty result with a shorter TTL to avoid re-running on every request.
 *
 * Provider/HTTP errors (no provider configured, circuit breaker open)
 * propagate to the caller — those are translated to 503 at the
 * controller layer, not hidden here.
 */
export async function callAndParseLlmOutput(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext = { feature: LLM_FEATURE_TAG },
): Promise<AiSuggestionsLlmOutputDto> {
  const first = await llmService.chat(options, context);
  const parsed = parseOnce(first.content);
  if (parsed) return parsed;

  const second = await llmService.chat(buildRetryOptions(options), context);
  const retried = parseOnce(second.content);
  if (retried) return retried;

  return { suggestions: [] };
}
