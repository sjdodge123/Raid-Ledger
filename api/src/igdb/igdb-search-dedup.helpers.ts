/**
 * Game search deduplication across IGDB and ITAD sources (ROK-1008).
 * Removes duplicate entries when the same game exists in both sources
 * with slightly different names (e.g., "Slay the Spire II" vs "Slay the Spire 2").
 */
import type { GameDetailDto } from '@raid-ledger/contract';

/**
 * Roman numeral replacements, ordered longest-first to avoid
 * partial matches (e.g., "VIII" before "VII" before "VI").
 */
const ROMAN_REPLACEMENTS: [RegExp, string][] = [
  [/\bVIII\b/gi, '8'],
  [/\bVII\b/gi, '7'],
  [/\bVI\b/gi, '6'],
  [/\bIV\b/gi, '4'],
  [/\bV\b/gi, '5'],
  [/\bIII\b/gi, '3'],
  [/\bII\b/gi, '2'],
];

/**
 * Normalize a game name for deduplication comparison.
 * - Lowercase
 * - Replace Roman numerals at word boundaries with Arabic equivalents
 * - Strip subtitle separator punctuation (colons, dashes surrounded by space)
 * - Collapse whitespace
 */
export function normalizeForDedup(name: string): string {
  let result = name.toLowerCase();
  for (const [pattern, replacement] of ROMAN_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  // Strip colons (subtitle separators)
  result = result.replace(/\s*:\s*/g, ' ');
  // Strip dashes acting as subtitle separators (surrounded by whitespace)
  result = result.replace(/\s+-\s+/g, ' ');
  // Collapse whitespace
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

/** Fields to copy from donor where winner has null/empty (IGDB metadata). */
const IGDB_NULL_FIELDS: (keyof GameDetailDto)[] = [
  'igdbId',
  'coverUrl',
  'summary',
  'rating',
  'aggregatedRating',
  'twitchGameId',
  'playerCount',
  'crossplay',
];

/** Array fields to copy from donor where winner has empty array. */
const IGDB_ARRAY_FIELDS: (keyof GameDetailDto)[] = [
  'genres',
  'gameModes',
  'themes',
  'platforms',
  'screenshots',
  'videos',
];

/** ITAD fields to copy from donor where winner has null/empty. */
const ITAD_NULL_FIELDS: (keyof GameDetailDto)[] = [
  'itadGameId',
  'itadBoxartUrl',
  'itadCurrentPrice',
  'itadCurrentCut',
  'itadCurrentShop',
  'itadLowestPrice',
  'itadLowestCut',
];

/** ITAD array fields to copy from donor where winner has empty array. */
const ITAD_ARRAY_FIELDS: (keyof GameDetailDto)[] = ['itadTags'];

/**
 * Copy enrichment data from donor into winner, without overwriting
 * fields that already have values on the winner.
 */
export function mergeEnrichment(
  winner: GameDetailDto,
  donor: GameDetailDto,
): void {
  copyNullFields(winner, donor, IGDB_NULL_FIELDS);
  copyEmptyArrayFields(winner, donor, IGDB_ARRAY_FIELDS);
  copyNullFields(winner, donor, ITAD_NULL_FIELDS);
  copyEmptyArrayFields(winner, donor, ITAD_ARRAY_FIELDS);
}

/** Copy fields from donor where winner's value is null or undefined. */
function copyNullFields(
  winner: GameDetailDto,
  donor: GameDetailDto,
  fields: (keyof GameDetailDto)[],
): void {
  for (const field of fields) {
    if (winner[field] == null && donor[field] != null) {
      (winner as Record<string, unknown>)[field] = donor[field];
    }
  }
}

/** Copy array fields from donor where winner's array is empty. */
function copyEmptyArrayFields(
  winner: GameDetailDto,
  donor: GameDetailDto,
  fields: (keyof GameDetailDto)[],
): void {
  for (const field of fields) {
    const winVal = winner[field];
    const donVal = donor[field];
    if (Array.isArray(winVal) && winVal.length === 0 && Array.isArray(donVal)) {
      (winner as Record<string, unknown>)[field] = donVal;
    }
  }
}

/**
 * Deduplicate games across IGDB and ITAD sources.
 *
 * Priority order: igdbId match > steamAppId match > normalized name match.
 * When deduplicating, the entry with itadGameId wins (ITAD is source of truth).
 * Enrichment from the loser is merged into the winner.
 */
export function deduplicateGames(games: GameDetailDto[]): GameDetailDto[] {
  const dedupIndex = new Map<string, number>();
  const result: (GameDetailDto | null)[] = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const matchIdx = findMatchInIndex(dedupIndex, game);

    if (matchIdx !== null) {
      handleDuplicate(result, dedupIndex, matchIdx, game);
    } else {
      addToIndex(dedupIndex, game, result.length);
      result.push(game);
    }
  }

  return result.filter((g): g is GameDetailDto => g !== null);
}

/** Build dedup keys for a game (igdbId, steamAppId, normalized name). */
function buildDedupKeys(game: GameDetailDto): string[] {
  const keys: string[] = [];
  if (game.igdbId != null) keys.push(`igdb:${game.igdbId}`);
  const steamId = (game as Record<string, unknown>).steamAppId;
  if (steamId != null) keys.push(`steam:${steamId}`);
  keys.push(`name:${normalizeForDedup(game.name)}`);
  return keys;
}

/** Find an existing match in the dedup index for the given game. */
function findMatchInIndex(
  index: Map<string, number>,
  game: GameDetailDto,
): number | null {
  for (const key of buildDedupKeys(game)) {
    const existing = index.get(key);
    if (existing !== undefined) return existing;
  }
  return null;
}

/** Add a game's keys to the dedup index. */
function addToIndex(
  index: Map<string, number>,
  game: GameDetailDto,
  position: number,
): void {
  for (const key of buildDedupKeys(game)) {
    index.set(key, position);
  }
}

/** Handle a duplicate: pick winner, merge enrichment, update index. */
function handleDuplicate(
  result: (GameDetailDto | null)[],
  dedupIndex: Map<string, number>,
  existingIdx: number,
  newGame: GameDetailDto,
): void {
  const existing = result[existingIdx]!;
  const { winner, loser } = pickWinner(existing, newGame);
  mergeEnrichment(winner, loser);
  result[existingIdx] = winner;
  // Re-index with the winner's keys in case they changed
  addToIndex(dedupIndex, winner, existingIdx);
}

/** Pick the winner between two duplicate games. ITAD entry wins. */
function pickWinner(
  a: GameDetailDto,
  b: GameDetailDto,
): { winner: GameDetailDto; loser: GameDetailDto } {
  if (b.itadGameId && !a.itadGameId) return { winner: b, loser: a };
  return { winner: a, loser: b };
}
