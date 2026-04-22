import type {
  LlmChatMessage,
  LlmChatOptions,
} from '../../ai/llm-provider.interface';
import type { CandidateContext } from './candidate-pool.helpers';
import type { VoterScopeStrategy } from './voter-scope.helpers';

/** Cap LLM response tokens — 10 suggestions × ~60 tokens each ≈ 600. */
const MAX_RESPONSE_TOKENS = 800;
/** Slight temperature so the LLM has some latitude in its reasoning. */
const PROMPT_TEMPERATURE = 0.3;

/**
 * Top-N axes by score — feeds the LLM a compact narrative instead of
 * the full 24-dim vector. 5 keeps prompt under control and still
 * captures the "what this group likes" signal.
 */
const TOP_AXES = 5;

function topAxes(
  dims: Record<string, number> | null,
  n: number = TOP_AXES,
): { axis: string; score: number }[] {
  if (!dims) return [];
  return Object.entries(dims)
    .map(([axis, score]) => ({ axis, score: Number(score) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function describeCandidate(c: CandidateContext, voterTotal: number): string {
  const axes = topAxes(c.dimensions)
    .map((a) => `${a.axis}:${a.score.toFixed(2)}`)
    .join(', ');
  const sim = c.similarity.toFixed(3);
  const ownership = `${c.ownershipCount}/${voterTotal} own`;
  const players = c.playerCount
    ? `${c.playerCount.min}-${c.playerCount.max} players`
    : 'players unknown';
  const sale =
    c.saleCut != null && c.saleCut > 0
      ? `ON SALE -${c.saleCut}%${c.nonOwnerPrice != null ? ` $${c.nonOwnerPrice.toFixed(2)}` : ''}`
      : c.nonOwnerPrice != null
        ? `full price $${c.nonOwnerPrice.toFixed(2)}`
        : 'price unknown';
  return `- id=${c.gameId} name="${c.name}" similarity=${sim} ${ownership} ${players} ${sale} top_axes=[${axes}]`;
}

function strategyGuidance(
  strategy: VoterScopeStrategy,
  voterCount: number,
  minPlayerCount: number,
): string {
  const sizingRule = `Every candidate already supports at least ${minPlayerCount} concurrent players — do not question playability, but break ties by preferring games whose player range comfortably includes ${voterCount}.`;
  if (strategy === 'small_group') {
    return [
      `This is a SMALL GROUP (${voterCount} voters).`,
      'Lean heavily on their individual taste overlap. Favor hidden gems',
      'the group has not tried yet.',
      sizingRule,
    ].join(' ');
  }
  if (strategy === 'partial') {
    return [
      `This is a PARTIAL GROUP (${voterCount} voters).`,
      "Blend community-wide patterns with voter-specific libraries. Favor",
      "games that match the group's strongest shared axes.",
      sizingRule,
    ].join(' ');
  }
  return [
    `This is a FULL COMMUNITY (${voterCount} voters).`,
    'Rely on community-wide patterns: popular genres, frequently played',
    'categories, trending community interests. Avoid niche picks that',
    'only 1-2 members would enjoy.',
    sizingRule,
  ].join(' ');
}

const BIAS_RULES = [
  'Ranking tie-breakers, in priority order:',
  '1. Prefer games where at least one voter already owns it (ownership bias — lower friction).',
  '2. Prefer games currently on sale (look for "ON SALE -N%") over full-price picks at similar fit.',
  '3. Prefer stronger taste-axis overlap with the voter centroid top axes.',
  '4. Prefer player-count ranges that hug the voter count rather than huge max-player lobbies.',
].join(' ');

/**
 * Compose the `LlmChatOptions` for a single suggestion pass. System
 * prompt explains the task + constraints; user prompt carries the voter
 * centroid summary + candidate shortlist + the required output schema.
 */
export function buildSuggestionPrompt(params: {
  strategy: VoterScopeStrategy;
  voterCount: number;
  minPlayerCount: number;
  centroidAxes: { axis: string; score: number }[];
  candidates: CandidateContext[];
}): LlmChatOptions {
  const systemPrompt = [
    'You recommend video games for a community gaming lineup.',
    'You will receive a ranked list of candidate games (already filtered to',
    'multiplayer-capable, group-sized, in-corpus titles) and a voter-taste summary.',
    'Your job: pick 5-10 games that best fit the group, with brief reasoning.',
    BIAS_RULES,
    'Respond ONLY with a single JSON object of the form:',
    '{"suggestions":[{"gameId":<int>,"confidence":<0..1>,"reasoning":"..."}]}',
    'Do not add prose, code fences, or extra keys. Only suggest games that',
    'appear in the candidate list by id. Keep `reasoning` under 280 chars.',
    'Mention the strongest single signal you used (ownership, sale, axis fit,',
    'or group-fit) in each reasoning line.',
  ].join(' ');

  const centroidLine = params.centroidAxes.length
    ? params.centroidAxes
        .map((a) => `${a.axis}:${a.score.toFixed(2)}`)
        .join(', ')
    : '(no voter vector data)';

  const userContent = [
    strategyGuidance(params.strategy, params.voterCount, params.minPlayerCount),
    '',
    `Voter count: ${params.voterCount}`,
    `Voter centroid top axes: ${centroidLine}`,
    '',
    'Candidate games (ownership = voters who already own via Steam; players = min-max concurrent players; sale = current deal cut):',
    ...params.candidates.map((c) => describeCandidate(c, params.voterCount)),
    '',
    'Return JSON only.',
  ].join('\n');

  const messages: LlmChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
  return {
    messages,
    maxTokens: MAX_RESPONSE_TOKENS,
    temperature: PROMPT_TEMPERATURE,
    responseFormat: 'json',
  };
}

/**
 * Compute the element-wise mean of a list of equal-length taste
 * dimension maps. Used to feed the voter centroid to the prompt
 * builder. Returns an empty map when `vectors` is empty.
 */
export function computeCentroidAxes(
  vectors: Record<string, number>[],
): { axis: string; score: number }[] {
  if (vectors.length === 0) return [];
  const totals = new Map<string, number>();
  for (const v of vectors) {
    for (const [axis, score] of Object.entries(v)) {
      totals.set(axis, (totals.get(axis) ?? 0) + Number(score));
    }
  }
  const mean = [...totals.entries()].map(([axis, total]) => ({
    axis,
    score: total / vectors.length,
  }));
  return mean
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_AXES);
}
