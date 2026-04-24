import type {
  LlmChatMessage,
  LlmChatOptions,
} from '../ai/llm-provider.interface';

/** Cap LLM response tokens — 3-5 short category proposals. */
const MAX_RESPONSE_TOKENS = 1500;
/** Higher temperature to push genre + theme variety across proposals. */
const PROMPT_TEMPERATURE = 0.8;

export type CategoryTypeHint =
  | 'seasonal'
  | 'trend'
  | 'community_pattern'
  | 'event';

export interface TopPlayedGame {
  name: string;
  totalSeconds: number;
}

export interface TrendingGame {
  name: string;
  deltaPct: number;
}

export interface ExistingCategorySummary {
  name: string;
  categoryType: CategoryTypeHint;
}

export interface GenerationPromptInput {
  centroid: number[] | null;
  topPlayed: TopPlayedGame[];
  trending: TrendingGame[];
  existingCategories: ExistingCategorySummary[];
  seasonalHints: string[];
  maxProposals: number;
}

const AXIS_KEYS = [
  'co_op',
  'pvp',
  'rpg',
  'survival',
  'strategy',
  'social',
  'mmo',
] as const;

const CURATOR_ROLE = [
  'You are a games-discovery curator for a small gaming community.',
  'Use your judgement — the rules below are guardrails, not a script. You are',
  'expected to make editorial choices the community centroid + top-played +',
  'trending + season signal can support. Bring perspective, not just pattern',
  'matching. Propose fresh discovery-page category rows worth surfacing this',
  'week. Each proposal must be grounded in the signal and must NOT duplicate',
  'an existing category name.',
].join(' ');

const RULES = [
  'Rules (guardrails):',
  '1. Return 3 to 5 proposals.',
  '2. category_type is one of: seasonal, trend, community_pattern, event. Prefer a mix across the batch — 3 proposals of the same type is a dull row.',
  '3. theme_vector is an object with EXACTLY these keys (axis order matters, do not rename / add / drop):',
  `   ${AXIS_KEYS.join(', ')}. Each value is a float in [-1, 1].`,
  '4. population_strategy is one of:',
  '   - "vector": candidates resolved at request time via cosine similarity against the theme vector (use this by default).',
  '   - "fixed": candidate list locked at generation time. Only when a small hand-picked set is obviously best.',
  '   - "hybrid": vector similarity + filter_criteria post-filter.',
  '5. Prefer variety across proposals — don\'t return two near-identical themes. But the "dominant taste axis" doesn\'t need to be unique per proposal; use whatever spread reads best.',
  '6. filter_criteria.genre_tags is the MOST IMPORTANT field for curation quality. The backend matches these case-insensitively against the game\'s Steam/ITAD user tags (rich vocabulary: "Horror", "Roguelike", "Cozy", "Time Loop", "Psychological Horror", "Crafting", "Battle Royale", "Souls-like", "Cute", "Metroidvania", "Vampire Survivors-like", …). Unknown terms are kept as plain substring matchers — coining a tag is fine if it reads like a real Steam tag.',
  '   Pick 1-4 descriptors per proposal that actually narrow to what the category is about. Examples:',
  '   - "Ghost Hunt Crew"       → ["Horror", "Co-op", "Paranormal"]',
  '   - "Cozy Spring Afternoons"→ ["Cozy", "Relaxing", "Cute"]',
  '   - "Weekend Warriors"      → ["PvP", "Competitive"]',
  '   - "Rogue Spring"          → ["Roguelike", "Roguelite"]',
  '   Without these the cosine-only match over broad taste axes often produces off-theme sets.',
  '7. name: 3–120 chars, evocative and specific. "Cozy Spring Co-op" beats "Co-op Favorites".',
  '   description: 10–500 chars, written for end users.',
  '8. Do not repeat an existing category name, and avoid obvious paraphrases (e.g. "Haunted Co-op" of "Ghost Hunt Crew").',
  '9. When the season genuinely supports it, make at least one proposal seasonal and reference the month/season in the name or description. Skip this when nothing seasonal fits — don\'t force it.',
  '10. expires_at is REQUIRED on every proposal. Future ISO-8601 timestamp derived from "today is YYYY-MM-DD" above. Suggested windows:',
  '    - "trend": 14-28 days (trends move fast)',
  '    - "community_pattern": 28-56 days',
  '    - "seasonal": 30-90 days (end of the relevant season)',
  '    - "event": tied to the event date',
  '    Never return null or omit — rows without expires_at stick on the Games page forever.',
  '11. Return ONLY JSON — no prose, no markdown fences.',
].join('\n');

const OUTPUT_FORMAT = [
  'Output:',
  'Respond with a SINGLE JSON array (no wrapping object) of proposal objects:',
  '[{"name":"...","description":"...","category_type":"seasonal",',
  '  "theme_vector":{"co_op":0.4,"pvp":-0.1,"rpg":0.6,"survival":0.0,"strategy":0.2,"social":0.5,"mmo":0.0},',
  '  "filter_criteria":{"genre_tags":["horror"]},',
  '  "population_strategy":"hybrid",',
  '  "expires_at":"2026-12-01T00:00:00Z"}]',
].join('\n');

function describeCentroid(centroid: number[] | null): string {
  if (!centroid) {
    return 'Community centroid: unavailable (no eligible player taste vectors yet).';
  }
  if (centroid.length !== AXIS_KEYS.length) {
    return `Community centroid: malformed (length ${centroid.length}, expected ${AXIS_KEYS.length}).`;
  }
  const parts = AXIS_KEYS.map((axis, i) => `${axis}=${centroid[i].toFixed(2)}`);
  return `Community centroid (7-axis taste average across active players): ${parts.join(', ')}`;
}

function describeTopPlayed(games: TopPlayedGame[]): string {
  if (games.length === 0) return 'Top-played last 30 days: (no data)';
  const rows = games.map(
    (g) => `- "${g.name}" (${Math.round(g.totalSeconds / 3600)}h)`,
  );
  return ['Top-played last 30 days:', ...rows].join('\n');
}

function describeTrending(games: TrendingGame[]): string {
  if (games.length === 0) return 'Trending (week-over-week delta): (no data)';
  const rows = games.map(
    (g) => `- "${g.name}" (${g.deltaPct >= 0 ? '+' : ''}${g.deltaPct}%)`,
  );
  return ['Trending (week-over-week delta):', ...rows].join('\n');
}

function describeExisting(existing: ExistingCategorySummary[]): string {
  if (existing.length === 0)
    return 'Existing approved categories: (none — any name is available)';
  const rows = existing.map((c) => `- "${c.name}" [${c.categoryType}]`);
  return [
    'Existing approved categories (do NOT repeat these names):',
    ...rows,
  ].join('\n');
}

function describeSeasonal(hints: string[]): string {
  if (hints.length === 0) return 'Seasonal hints: (none in effect right now)';
  return `Seasonal hints (consider at least one seasonal proposal): ${hints.join('; ')}`;
}

/**
 * Compose an `LlmChatOptions` for a dynamic-category generation pass. The
 * prompt structure is: a system message locking rules + output format, and a
 * user message carrying the current community signal (centroid, top-played,
 * trending, existing-category dedup list, seasonal hints).
 */
export function buildGenerationPrompt(
  input: GenerationPromptInput,
): LlmChatOptions {
  const systemPrompt = [CURATOR_ROLE, RULES, OUTPUT_FORMAT].join('\n\n');

  const userBlocks = [
    `Produce up to ${input.maxProposals} proposals.`,
    describeCentroid(input.centroid),
    describeTopPlayed(input.topPlayed),
    describeTrending(input.trending),
    describeExisting(input.existingCategories),
    describeSeasonal(input.seasonalHints),
    'Return JSON only.',
  ];

  const messages: LlmChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userBlocks.join('\n\n') },
  ];

  return {
    messages,
    maxTokens: MAX_RESPONSE_TOKENS,
    temperature: PROMPT_TEMPERATURE,
    responseFormat: 'json',
  };
}
