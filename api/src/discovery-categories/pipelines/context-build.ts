import type {
  ExistingCategorySummary,
  GenerationPromptInput,
  TopPlayedGame,
  TrendingGame,
} from '../prompt-builder.helpers';

export interface LoadedContext {
  centroid: number[] | null;
  topPlayed: TopPlayedGame[];
  trending: TrendingGame[];
  existingCategories: ExistingCategorySummary[];
}

/**
 * Seasonal hints surface calendar context to the LLM. Windows overlap for
 * transitions (e.g. spooky season bleeds into autumn harvest).
 * Always includes at least the current ISO date and month name so the LLM
 * has a concrete anchor even outside a named window.
 */
export function seasonalHintsFor(now: Date): string[] {
  const month = now.getUTCMonth(); // 0 = Jan
  const day = now.getUTCDate();
  const monthName = now.toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  });
  const hints: string[] = [
    `today is ${now.toISOString().slice(0, 10)} (${monthName})`,
  ];

  if (month === 1 && day >= 7) hints.push("Valentine's / couples play");
  if (month === 2) hints.push('early spring, longer days returning');
  if (month === 3) hints.push('mid-spring, Easter window');
  if (month === 4) hints.push('late spring, outdoor-vs-indoor balance');
  if (month === 5) hints.push('early summer, long evenings');
  if (month === 5 && day >= 15) hints.push('Steam Summer Sale window');
  if (month === 6) hints.push('peak summer / Steam Summer Sale');
  if (month === 7) hints.push('late summer, vacation gaming');
  if (month === 8) hints.push('back-to-school / early autumn');
  if (month === 9 && day < 15) hints.push('early autumn, cozy weather');
  if (month === 9 && day >= 15) hints.push('Halloween (mid-to-late October)');
  if (month === 10 && day <= 7) hints.push('post-Halloween / early November');
  if (month === 10 && day >= 15) hints.push('Steam Autumn Sale window');
  if (month === 10 && day >= 20) hints.push('Thanksgiving week');
  if (month === 11) hints.push('winter holidays (December)');
  if (month === 11 && day >= 15) hints.push('Steam Winter Sale window');
  if (month === 0) hints.push('New Year / early January, fresh starts');
  if (month === 1) hints.push('mid-winter, indoor gaming peak');

  return hints;
}

/**
 * Assemble a prompt-ready input from loaded signal + a wall-clock timestamp.
 * Pure function — no I/O — so it is trivial to test with fixed dates.
 */
export function buildGenerationContext(
  loaded: LoadedContext,
  now: Date,
  maxProposals: number,
): GenerationPromptInput {
  return {
    centroid: loaded.centroid,
    topPlayed: loaded.topPlayed,
    trending: loaded.trending,
    existingCategories: loaded.existingCategories,
    seasonalHints: seasonalHintsFor(now),
    maxProposals,
  };
}
