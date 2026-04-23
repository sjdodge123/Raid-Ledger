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
 * transitions (e.g. spooky season bleeds into autumn harvest) and are
 * deliberately lightweight — anything richer can live in the prompt rules.
 */
export function seasonalHintsFor(now: Date): string[] {
  const month = now.getUTCMonth(); // 0 = Jan
  const day = now.getUTCDate();
  const hints: string[] = [];

  if (month === 9 && day >= 15) hints.push('Halloween (mid-to-late October)');
  if (month === 10 && day <= 7) hints.push('post-Halloween / early November');
  if (month === 10 && day >= 20) hints.push('Thanksgiving week');
  if (month === 11) hints.push('winter holidays (December)');
  if (month === 0) hints.push('New Year / early January');
  if (month === 1) hints.push('mid-winter (February)');
  if (month >= 2 && month <= 4) hints.push('spring');
  if (month >= 5 && month <= 7) hints.push('summer');
  if (month === 8) hints.push('back-to-school / early autumn');
  if (month === 9 && day < 15) hints.push('early autumn');
  if (month === 6) hints.push('summer sale window');
  if (month === 5 && day >= 15) hints.push('Steam Summer Sale window');
  if (month === 10 && day >= 15) hints.push('Steam Autumn Sale window');
  if (month === 11) hints.push('Steam Winter Sale window');

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
