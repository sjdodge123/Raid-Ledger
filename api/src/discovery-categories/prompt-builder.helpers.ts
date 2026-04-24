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
  'Propose fresh discovery-page category rows that will surface games worth',
  'surfacing this week. Each proposal must be grounded in the community',
  'signal below — centroid taste axes, top-played titles, trending deltas,',
  'and the current season — and must NOT duplicate an existing category name.',
  'Variety across proposals is critical: the user sees all of them side-by-side',
  'on the Games page, so near-duplicate themes (e.g. two co-op picks, two MMO',
  'picks) are a failure.',
].join(' ');

const RULES = [
  'Rules:',
  `1. Return BETWEEN 3 AND 5 proposals — no more.`,
  '2. Each proposal MUST have a category_type of one of: seasonal, trend, community_pattern, event.',
  '3. DIVERSITY: each proposal\'s DOMINANT axis (the axis with the highest absolute value in its theme_vector) MUST be DIFFERENT from every other proposal in this batch. Across 3-5 proposals you must span at least 3 different dominant axes out of [co_op, pvp, rpg, survival, strategy, social, mmo]. Never return two proposals that are both co_op-dominant, both mmo-dominant, etc.',
  '4. DIVERSITY 2: category_types must be varied — do NOT return all community_pattern or all trend. Aim for a mix.',
  '5. Each proposal MUST include a theme_vector object with EXACTLY these keys, each a float in [-1, 1]:',
  `   ${AXIS_KEYS.join(', ')}.`,
  '   Axis order matters — do not rename, add, or drop keys.',
  '6. Each proposal MUST set population_strategy to ONE of: "vector", "fixed", "hybrid".',
  '   - "vector": candidates resolved at request time via cosine similarity against the theme vector.',
  '   - "fixed": candidate list locked at generation time; use only when a small hand-picked list is obviously best.',
  '   - "hybrid": vector similarity, post-filtered by genre_tags in filter_criteria.',
  '7. filter_criteria.genre_tags is STRONGLY RECOMMENDED for every proposal — the backend post-filters candidates to games whose IGDB genre/theme includes at least one resolved tag. Without it, the cosine search over 7 broad taste axes often returns semantically-off matches (e.g. a "Ghost Hunt Crew" horror row full of non-horror co-op games).',
  '   Supported tags (use these spellings; unknown tags are silently dropped):',
  '   - THEMES: action, fantasy, sci-fi, horror, paranormal, thriller, survival, historical, stealth, comedy, drama, sandbox, open-world, warfare, party, 4x, mystery, romance',
  '   - GENRES: shooter, fps, platformer, puzzle, racing, rts, rpg, simulation, sport, strategy, turn-based-strategy, tactical, hack-and-slash, adventure, indie, arcade, visual-novel, card-game, board-game, moba, fighting, point-and-click, mmorpg, mmo',
  '   Pick 1-3 tags per proposal that actually describe the theme. "Ghost Hunt Crew" → ["horror", "paranormal"]. "Cozy Winter Co-op" → ["adventure", "sandbox"]. "Spring Awakening MMOs" → ["mmorpg"].',
  '8. name: 3–120 chars — make it evocative and specific, NOT generic. "Cozy Winter Co-op" beats "Co-op Favorites". description: 10–500 chars; write for end users, not for the LLM.',
  '9. DO NOT repeat an existing category name from the list below AND do not propose themes that overlap semantically with an existing name (e.g. if "Ghost Hunt Crew" exists, do NOT propose "Haunted Co-op" or "Paranormal Night").',
  '10. When seasonal hints are present, AT LEAST ONE proposal MUST be category_type="seasonal" and reference the current month or season in its name or description.',
  '11. expires_at: REQUIRED for EVERY proposal — set it to a future ISO-8601 timestamp derived from "today is YYYY-MM-DD" above. Suggested windows by category_type:',
  '    - "trend": 14-28 days out (trends move fast)',
  '    - "community_pattern": 28-56 days out',
  '    - "seasonal": tied to the end of the season — typically 30-90 days',
  '    - "event": tied to the actual event date',
  '    Never return null or omit this field. Rows without expires_at would stick on the Games page forever.',
  '12. Return ONLY JSON — no prose, no markdown fences.',
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
