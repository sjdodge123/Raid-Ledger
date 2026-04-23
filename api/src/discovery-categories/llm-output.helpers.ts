import { Logger } from '@nestjs/common';
import type { LlmCategoryProposalDto } from '@raid-ledger/contract';
import { LlmCategoryProposalSchema } from '@raid-ledger/contract';
import type { LlmService } from '../ai/llm.service';
import type {
  LlmChatMessage,
  LlmChatOptions,
  LlmRequestContext,
} from '../ai/llm-provider.interface';

/** Feature tag for dynamic-category LLM requests (surfaces in ai_request_logs). */
export const LLM_FEATURE_TAG = 'dynamic_categories';

const RETRY_REMINDER =
  'Your previous response was not valid JSON matching the required schema. ' +
  'Respond ONLY with a single JSON array of proposal objects — no prose, ' +
  'no markdown fences, no wrapping object. Each proposal MUST include ' +
  'name, description, category_type, theme_vector (with keys co_op, pvp, ' +
  'rpg, survival, strategy, social, mmo), and population_strategy.';

/**
 * Error surfaced when both LLM attempts failed with a provider error
 * (unreachable, rate limit, transient 5xx). Distinct from a parse failure,
 * which resolves to an empty proposal list so the caller can log + skip
 * without touching approved rows.
 */
export class LlmUnavailableError extends Error {
  readonly name = 'LlmUnavailableError';
}

/** Extract the first JSON value (array OR object) from an LLM text response. */
function extractJson(content: string): unknown {
  const arrayStart = content.indexOf('[');
  const objectStart = content.indexOf('{');
  let start = -1;
  let endChar = ']';
  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    start = arrayStart;
    endChar = ']';
  } else if (objectStart !== -1) {
    start = objectStart;
    endChar = '}';
  }
  if (start === -1) return null;
  const end = content.lastIndexOf(endChar);
  if (end < start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Parse an LLM response into an array of validated proposals. Returns null on
 * any parse or schema failure so the caller can decide to retry or skip.
 */
function parseOnce(content: string): LlmCategoryProposalDto[] | null {
  const raw = extractJson(content);
  if (raw === null) return null;
  const asArray = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as Record<string, unknown>).proposals)
      ? ((raw as Record<string, unknown>).proposals as unknown[])
      : null;
  if (asArray === null) return null;
  const validated: LlmCategoryProposalDto[] = [];
  for (const item of asArray) {
    const parsed = LlmCategoryProposalSchema.safeParse(item);
    if (parsed.success) validated.push(parsed.data);
  }
  if (validated.length === 0) return null;
  return validated;
}

function buildRetryOptions(original: LlmChatOptions): LlmChatOptions {
  const reminder: LlmChatMessage = { role: 'system', content: RETRY_REMINDER };
  return { ...original, messages: [...original.messages, reminder] };
}

type ChatAttempt =
  | { proposals: LlmCategoryProposalDto[] }
  | { parseFail: true }
  | { unavailable: Error };

async function tryChat(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext,
): Promise<ChatAttempt> {
  try {
    const response = await llmService.chat(options, context);
    const parsed = parseOnce(response.content);
    if (parsed) return { proposals: parsed };
    return { parseFail: true };
  } catch (err) {
    return { unavailable: err instanceof Error ? err : new Error(String(err)) };
  }
}

/**
 * Call `LlmService.chat`, parse JSON, retry once on EITHER a parse failure OR
 * a transient provider error. After two attempts:
 *   - both parse-failed → return `[]` (caller logs + skips, no stub rows).
 *   - last attempt failed with provider error → throw `LlmUnavailableError`.
 */
export async function callAndParseCategoryProposals(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext = { feature: LLM_FEATURE_TAG },
  logger?: Logger,
): Promise<LlmCategoryProposalDto[]> {
  const first = await tryChat(llmService, options, context);
  if ('proposals' in first) return first.proposals;

  if ('unavailable' in first) {
    logger?.warn(
      `dynamic_categories LLM attempt 1 unavailable: ${first.unavailable.message}`,
    );
  } else {
    logger?.warn(
      'dynamic_categories LLM attempt 1 returned unparseable output',
    );
  }

  const retryOpts = buildRetryOptions(options);
  const second = await tryChat(llmService, retryOpts, context);
  if ('proposals' in second) return second.proposals;

  if ('unavailable' in second) {
    throw new LlmUnavailableError(second.unavailable.message);
  }
  logger?.warn(
    'dynamic_categories LLM retry also returned unparseable output — skipping',
  );
  return [];
}
