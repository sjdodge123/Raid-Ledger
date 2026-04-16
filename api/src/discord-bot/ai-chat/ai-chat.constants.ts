/** Custom ID prefix for all AI chat buttons. */
export const AI_CHAT_PREFIX = 'ai';

/** Build a custom ID string: ai:{path} */
export function aiCustomId(path: string): string {
  return `${AI_CHAT_PREFIX}:${path}`;
}

/** Parse an AI chat custom ID, returning the path portion. */
export function parseAiCustomId(customId: string): string | null {
  if (!customId.startsWith(`${AI_CHAT_PREFIX}:`)) return null;
  return customId.slice(AI_CHAT_PREFIX.length + 1);
}

/** System prompt for leaf node summarization (kept under 200 tokens). */
export const SUMMARIZE_SYSTEM_PROMPT =
  'You are a concise gaming community assistant. ' +
  'Summarize the provided data in 1-3 sentences. ' +
  'Be friendly and direct. Do not use markdown. ' +
  'Focus on key details: names, dates, counts.';

/** Max tokens for LLM summarization responses. */
export const SUMMARY_MAX_TOKENS = 150;
/** Max tokens for LLM input. */
export const SUMMARY_MAX_INPUT_TOKENS = 1024;
/** Temperature for LLM summarization. */
export const SUMMARY_TEMPERATURE = 0.3;
/** Feature tag for LLM request logging. */
export const LLM_FEATURE_TAG = 'ai-chat';
/** Max characters in response content. */
export const MAX_RESPONSE_CHARS = 500;

/** Rate limit configuration. */
export const RATE_LIMITS = {
  perMinute: 5,
  perHour: 30,
  dailyCap: 500,
} as const;

/** Session TTL in milliseconds (5 minutes). */
export const SESSION_TTL_MS = 5 * 60_000;
/** Session sweep interval in milliseconds (60 seconds). */
export const SESSION_SWEEP_INTERVAL_MS = 60_000;

/** System prompt for free-text classification (10-token output cap). */
export const CLASSIFY_PROMPT =
  'Classify this message into one topic: events, signups, games, lineup, polls, stats. ' +
  'Respond with exactly one word.';

/** Map LLM classification output to a tree path. */
export function mapClassification(output: string): string | null {
  const word = output.toLowerCase().trim().split(/\s+/)[0];
  const map: Record<string, string> = {
    events: 'events',
    event: 'events',
    signups: 'my-signups',
    signup: 'my-signups',
    games: 'game-library',
    game: 'game-library',
    lineup: 'lineup',
    polls: 'polls',
    poll: 'polls',
    stats: 'stats',
    stat: 'stats',
  };
  return map[word] ?? null;
}

/** Keyword map for free-text routing to tree paths. */
export const KEYWORD_MAP: Record<string, string> = {
  event: 'events',
  events: 'events',
  signup: 'my-signups',
  signups: 'my-signups',
  'my signups': 'my-signups',
  game: 'game-library',
  games: 'game-library',
  'game library': 'game-library',
  library: 'game-library',
  lineup: 'lineup',
  lineups: 'lineup',
  poll: 'polls',
  polls: 'polls',
  vote: 'polls',
  stat: 'stats',
  stats: 'stats',
  analytics: 'stats',
};
