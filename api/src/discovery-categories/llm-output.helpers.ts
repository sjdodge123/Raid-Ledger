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

/**
 * Extract the first JSON value (array OR object) from an LLM text response.
 * Resilient to truncated arrays — if the LLM hits a token cap mid-object,
 * we recover the completed-object prefix and drop the unfinished tail.
 */
function extractJson(content: string): unknown {
  const arrayStart = content.indexOf('[');
  const objectStart = content.indexOf('{');
  const startsWithArray =
    arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart);
  if (startsWithArray) return parseArrayResilient(content, arrayStart);
  if (objectStart !== -1) {
    const end = content.lastIndexOf('}');
    if (end < objectStart) return null;
    try {
      return JSON.parse(content.slice(objectStart, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Try to parse a JSON array. If the full array is malformed (common when
 * the LLM truncates mid-object), recover the completed objects by walking
 * brace depth and keeping everything up to the last `}` that closes at
 * depth 1 (i.e. inside the outer array).
 */
function parseArrayResilient(content: string, start: number): unknown {
  const from = start + 1;
  const end = content.lastIndexOf(']');
  if (end > start) {
    try {
      return JSON.parse(content.slice(start, end + 1)) as unknown;
    } catch {
      // fall through to recovery
    }
  }
  // Recovery: collect objects that close cleanly at depth 1.
  const completed: unknown[] = [];
  let i = from;
  while (i < content.length) {
    // skip whitespace + comma
    while (i < content.length && /[\s,]/.test(content[i])) i += 1;
    if (i >= content.length || content[i] !== '{') break;
    const objStart = i;
    let depth = 0;
    let inStr = false;
    let escape = false;
    for (; i < content.length; i += 1) {
      const ch = content[i];
      if (inStr) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const slice = content.slice(objStart, i + 1);
          try {
            completed.push(JSON.parse(slice));
          } catch {
            // malformed object — stop, keep what we have
            return completed.length > 0 ? completed : null;
          }
          i += 1;
          break;
        }
      }
    }
    if (depth !== 0) break; // truncated object
  }
  return completed.length > 0 ? completed : null;
}

interface ParseResult {
  proposals: LlmCategoryProposalDto[] | null;
  /** Zod issues collected across rejected proposals (diagnostic only). */
  zodIssues: string[];
  /** First ~400 chars of the raw content (diagnostic only). */
  snippet: string;
}

/**
 * Parse an LLM response into an array of validated proposals. Returns a
 * structured result so the caller can log Zod issues + raw-content snippet
 * when both attempts fail — critical for debugging prompt / model drift.
 */
function parseOnce(content: string): ParseResult {
  const snippet = content.slice(0, 400);
  const raw = extractJson(content);
  if (raw === null) {
    return { proposals: null, zodIssues: ['no JSON found'], snippet };
  }
  const asArray = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' &&
        raw !== null &&
        Array.isArray((raw as Record<string, unknown>).proposals)
      ? ((raw as Record<string, unknown>).proposals as unknown[])
      : null;
  if (asArray === null) {
    return { proposals: null, zodIssues: ['not an array'], snippet };
  }
  const validated: LlmCategoryProposalDto[] = [];
  const zodIssues: string[] = [];
  for (const item of asArray) {
    const parsed = LlmCategoryProposalSchema.safeParse(item);
    if (parsed.success) {
      validated.push(parsed.data);
    } else {
      const first = parsed.error.errors[0];
      if (first) {
        zodIssues.push(`${first.path.join('.')}: ${first.message}`);
      }
    }
  }
  if (validated.length === 0)
    return { proposals: null, zodIssues, snippet };
  return { proposals: validated, zodIssues, snippet };
}

function buildRetryOptions(original: LlmChatOptions): LlmChatOptions {
  const reminder: LlmChatMessage = { role: 'system', content: RETRY_REMINDER };
  return { ...original, messages: [...original.messages, reminder] };
}

type ChatAttempt =
  | { proposals: LlmCategoryProposalDto[] }
  | { parseFail: true; zodIssues: string[]; snippet: string }
  | { unavailable: Error };

async function tryChat(
  llmService: LlmService,
  options: LlmChatOptions,
  context: LlmRequestContext,
): Promise<ChatAttempt> {
  try {
    const response = await llmService.chat(options, context);
    const parsed = parseOnce(response.content);
    if (parsed.proposals) return { proposals: parsed.proposals };
    return {
      parseFail: true,
      zodIssues: parsed.zodIssues,
      snippet: parsed.snippet,
    };
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
      `dynamic_categories LLM attempt 1 parse fail — issues=[${first.zodIssues.join(' | ')}] snippet=${JSON.stringify(first.snippet)}`,
    );
  }

  const retryOpts = buildRetryOptions(options);
  const second = await tryChat(llmService, retryOpts, context);
  if ('proposals' in second) return second.proposals;

  if ('unavailable' in second) {
    throw new LlmUnavailableError(second.unavailable.message);
  }
  logger?.warn(
    `dynamic_categories LLM retry also parse fail — skipping. issues=[${second.zodIssues.join(' | ')}] snippet=${JSON.stringify(second.snippet)}`,
  );
  return [];
}
