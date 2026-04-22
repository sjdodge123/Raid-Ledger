import type {
  LlmChatMessage,
  LlmChatOptions,
} from '../../ai/llm-provider.interface';
import type { CandidateContext } from './candidate-pool.helpers';
import type { VoterScopeStrategy } from './voter-scope.helpers';
import type { VoterProfile } from './voter-profile.helpers';
import type { RecentWinner } from './recent-winners.helpers';

/** Cap LLM response tokens — Option E asks for fewer but richer picks. */
const MAX_RESPONSE_TOKENS = 1200;
/** Slight temperature so the LLM has some latitude in its reasoning. */
const PROMPT_TEMPERATURE = 0.3;

/** Top-N candidate axes surfaced per game — keeps the prompt focused. */
const CANDIDATE_AXIS_COUNT = 5;

function topAxes(
  dims: Record<string, number> | null,
  n: number,
): { axis: string; score: number }[] {
  if (!dims) return [];
  return Object.entries(dims)
    .map(([axis, score]) => ({ axis, score: Number(score) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function sourceLabel(source: CandidateContext['source']): string {
  if (source === 'wildcard_popular') return 'WILDCARD: community favourite';
  if (source === 'wildcard_sale') return 'WILDCARD: deep sale';
  if (source === 'taste_discovery') return 'TASTE-MATCH: discovery';
  return 'TASTE-MATCH';
}

function describeCandidate(c: CandidateContext, voterTotal: number): string {
  const axes = topAxes(c.dimensions, CANDIDATE_AXIS_COUNT)
    .map((a) => `${a.axis}:${a.score.toFixed(2)}`)
    .join(', ');
  const simLabel =
    c.source === 'wildcard_popular' || c.source === 'wildcard_sale'
      ? 'sim=n/a'
      : `sim=${c.similarity.toFixed(3)}`;
  const ownership = `${c.ownershipCount}/${voterTotal} voters own`;
  const community =
    c.communityOwnerCount === 0
      ? 'DISCOVERY (0 community owners)'
      : `${c.communityOwnerCount} community owners`;
  const players = c.playerCount
    ? `${c.playerCount.min}-${c.playerCount.max} players`
    : 'players unknown';
  const sale =
    c.saleCut != null && c.saleCut > 0
      ? `SALE -${c.saleCut}%${c.nonOwnerPrice != null ? ` $${c.nonOwnerPrice.toFixed(2)}` : ''}`
      : c.nonOwnerPrice != null
        ? `full price $${c.nonOwnerPrice.toFixed(2)}`
        : 'price unknown';
  const axesPart = axes ? `axes=[${axes}]` : 'axes=(no vector data)';
  return `- [${sourceLabel(c.source)}] id=${c.gameId} "${c.name}" ${simLabel} ${ownership} ${community} ${players} ${sale} ${axesPart}`;
}

function describeVoter(profile: VoterProfile): string {
  const axes = profile.topAxes
    .map((a) => `${a.axis}:${a.score.toFixed(2)}`)
    .join(', ');
  const archetype =
    profile.archetypeLabels.length > 0
      ? profile.archetypeLabels.join(', ')
      : 'unclassified';
  const tier = profile.intensityTier ? ` / ${profile.intensityTier}` : '';
  const lines: string[] = [
    `- ${profile.username} (${archetype}${tier}) top axes: [${axes}]`,
  ];
  if (profile.recentlyPlayed.length > 0) {
    const recent = profile.recentlyPlayed
      .map((p) => `${p.gameName} ${p.minutes2Weeks}min`)
      .join(', ');
    lines.push(`    recent Steam playtime (last 2w): ${recent}`);
  }
  if (profile.coPlayPartners.length > 0) {
    const partners = profile.coPlayPartners
      .map((p) => `${p.username} (${p.hoursTogether}h together)`)
      .join(', ');
    lines.push(`    frequent co-play partners: ${partners}`);
  }
  if (profile.recentEventGames.length > 0) {
    const games = profile.recentEventGames.join(', ');
    lines.push(`    events signed up for (last 30d): ${games}`);
  }
  return lines.join('\n');
}

function describeWinner(w: RecentWinner): string {
  const tagPreview = w.tags.slice(0, 4).join(', ');
  return `- "${w.name}" tags=[${tagPreview}]`;
}

function sizingClause(voterCount: number, minPlayerCount: number): string {
  return `Group size is ${voterCount} voter${voterCount === 1 ? '' : 's'}. Every candidate already supports at least ${minPlayerCount} concurrent players, so playability is not in question — prefer games whose player range hugs ${voterCount} rather than massive max-lobby titles.`;
}

function scopeClause(strategy: VoterScopeStrategy, voterCount: number): string {
  if (strategy === 'small_group') {
    return `This is a SMALL GROUP (${voterCount} voters). Lean into individual voter tastes below; surface hidden gems this exact group hasn't tried.`;
  }
  if (strategy === 'partial') {
    return `This is a PARTIAL group (${voterCount} voters). Look for the strongest shared axes across voters and balance against community-wide appeal.`;
  }
  return `This is the FULL COMMUNITY (${voterCount} voters). Favour broad appeal and community-level genre trends over per-voter niche matches.`;
}

const CURATOR_ROLE = [
  'You are a games curator for a community gaming night. The Raid Ledger',
  'product has already filtered the candidate pool to multiplayer-capable,',
  'group-sized games. The pool mixes four kinds of candidates — each one',
  'is tagged in the list below:',
  '  - [TASTE-MATCH]            vector-similar to the voter centroid; most',
  '                              reliable signal, ranks by similarity.',
  '  - [TASTE-MATCH: discovery] vector-similar AND zero community owners —',
  '                              untried games the group might genuinely like.',
  '  - [WILDCARD: community favourite] NOT taste-matched, but titles the',
  '                              community has put the most hours into.',
  '                              Worth considering as a crowd-pleaser.',
  '  - [WILDCARD: deep sale]     NOT taste-matched, currently on a steep',
  '                              discount (≥50% off). Opportunistic pick.',
  '',
  'YOUR JOB IS NOT TO RE-RANK THE VECTOR OUTPUT. Your job is to pick the',
  '3-7 games you would genuinely recommend tonight, treating the candidate',
  'list as a menu you can reject from.',
].join(' ');

const CURATOR_RULES = [
  'Rules:',
  '1. Pick 3 to 7 games. If fewer than 3 candidates feel genuinely worth recommending, pick fewer — do not pad.',
  '2. MIX GENRES across your picks. If 4 candidates are all fighting games, pick AT MOST 1.',
  "3. AVOID repeating the community's recent lineup-winner genres (listed below) — 2+ consecutive wins in the same genre = skip that genre this round.",
  '4. DISCOVERY REQUIREMENT — Common Ground already shows the community what they already own. AT LEAST 30% of your picks (or at least 1, whichever is greater) MUST be tagged "DISCOVERY (0 community owners)" in the candidate list. Picks already well-owned by the community belong on Common Ground, not in your curated list.',
  '5. WILDCARD OPPORTUNITY — try to include ONE wildcard pick (either [WILDCARD: community favourite] or [WILDCARD: deep sale]) when a genuinely compelling one exists. These are intentionally not taste-matched; they are meant to mix things up. Do not force a wildcard if none fit, but do not reflexively reject them either.',
  '6. For each pick, your reasoning must compare it to an alternative: "I chose X over Y because ..." If the pick is a wildcard, the reasoning should note that (e.g. "wildcard pick — 85% off and the community already has 500+ hours in it").',
  '7. Priority order when picks are close:',
  '   (a) Group-size fit (player range tightly matches voter count)',
  '   (b) Ownership (at least one voter already owns it — lower friction)',
  '   (c) Sale status (current deal)',
  '   (d) Per-voter axis alignment',
  '8. Return picks in the order of your own conviction — the first pick is your STRONGEST recommendation.',
].join(' ');

const OUTPUT_FORMAT = [
  'Output:',
  'Respond ONLY with a single JSON object of the form:',
  '{"suggestions":[{"gameId":<int>,"reasoning":"..."}]}',
  'Do NOT include confidence, tier, rank, or any other field — your output ORDER is the ranking.',
  'Do NOT include prose, markdown, or code fences.',
  'Each reasoning line must be under 280 chars and mention the comparison (rule 4).',
].join(' ');

/**
 * Compose the `LlmChatOptions` for a curator-mode suggestion pass.
 *
 * Prompt structure:
 *   1. System — curator role + rules + output format
 *   2. User — voter profiles (individuals) + recent winners +
 *      candidate pool (richly annotated).
 */
export function buildSuggestionPrompt(params: {
  strategy: VoterScopeStrategy;
  voterCount: number;
  minPlayerCount: number;
  voterProfiles: VoterProfile[];
  recentWinners: RecentWinner[];
  candidates: CandidateContext[];
}): LlmChatOptions {
  const systemPrompt = [CURATOR_ROLE, CURATOR_RULES, OUTPUT_FORMAT].join('\n\n');

  const winnersBlock =
    params.recentWinners.length > 0
      ? [
          'Recent lineup winners (do not re-pick these genres if 2+ consecutive):',
          ...params.recentWinners.map(describeWinner),
        ].join('\n')
      : 'Recent lineup winners: (none yet — community has no decided lineups)';

  const votersBlock =
    params.voterProfiles.length > 0
      ? [
          `Voter profiles (${params.voterProfiles.length} individuals — reason about each, not just the group):`,
          ...params.voterProfiles.map(describeVoter),
        ].join('\n')
      : '(voter profiles unavailable — fall back on candidate axis data alone)';

  const userContent = [
    scopeClause(params.strategy, params.voterCount),
    sizingClause(params.voterCount, params.minPlayerCount),
    '',
    votersBlock,
    '',
    winnersBlock,
    '',
    'Candidate pool (pre-ranked by vector similarity to voter centroid; you can reject any):',
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
