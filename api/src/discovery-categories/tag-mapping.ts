/**
 * Tag filter resolution for dynamic-discovery-category candidates.
 *
 * The LLM curates with Steam-tag-style descriptors
 * ("Horror", "Roguelike", "Cozy", "Time Loop", "Zombies", "Co-op",
 * "Psychological Horror", …). This module converts those descriptors into
 * a filter that the candidate resolver applies post-cosine-search.
 *
 * Match priority (consistent with the rest of the codebase — see
 * `api/src/taste-profile/axis-mapping.constants.ts`):
 *   1. ITAD / Steam user tags (`games.itadTags: string[]`) — richest
 *      vocabulary, case-insensitive substring match against the canonical
 *      form of each LLM tag.
 *   2. IGDB genre IDs (`games.genres: number[]`) and theme IDs
 *      (`games.themes: number[]`) — fallback for games whose ITAD tags
 *      haven't been fetched yet. Only populated for a small set of
 *      well-known bucket terms.
 *
 * A game passes the filter if it hits EITHER source. Unknown LLM
 * descriptors are still respected — they become plain substring matchers
 * against `games.itadTags`, so novel curation (e.g. "Cozy", "Vibes-based")
 * works without code changes as long as the community-sourced Steam tag
 * vocabulary covers it.
 */

export interface TagFilterSet {
  /** Lowercased substrings to match against `games.itadTags`. */
  itadSubstrings: string[];
  /** IGDB genre IDs for fallback match on `games.genres`. */
  igdbGenreIds: number[];
  /** IGDB theme IDs for fallback match on `games.themes`. */
  igdbThemeIds: number[];
}

const EMPTY: TagFilterSet = {
  itadSubstrings: [],
  igdbGenreIds: [],
  igdbThemeIds: [],
};

/**
 * Canonical-form synonyms for common LLM shorthand. Each entry maps a
 * normalised LLM string to the substring(s) that should be matched against
 * `games.itadTags`. Lets curators write "scifi" and still match
 * "Sci-fi" / "Science Fiction" in Steam's vocabulary.
 */
const ITAD_SYNONYMS: Readonly<Record<string, string[]>> = Object.freeze({
  scifi: ['sci-fi', 'science fiction'],
  sciencefiction: ['sci-fi', 'science fiction'],
  fps: ['first-person shooter', 'fps'],
  firstpersonshooter: ['first-person shooter', 'fps'],
  tps: ['third-person shooter'],
  thirdpersonshooter: ['third-person shooter'],
  roleplaying: ['rpg', 'role playing', 'role-playing'],
  rpg: ['rpg', 'role playing'],
  jrpg: ['jrpg'],
  mmorpg: ['mmo', 'massively multiplayer'],
  mmo: ['mmo', 'massively multiplayer'],
  turnbasedstrategy: ['turn-based strategy', 'turn based strategy'],
  tbs: ['turn-based strategy'],
  rts: ['real-time strategy', 'rts'],
  realtimestrategy: ['real-time strategy', 'rts'],
  moba: ['moba'],
  openworld: ['open world'],
  sandbox: ['sandbox'],
  paranormal: ['horror', 'supernatural', 'paranormal'],
  spooky: ['horror', 'spooky'],
  cozy: ['cute', 'relaxing', 'casual', 'wholesome'],
  wholesome: ['wholesome', 'cute'],
  chill: ['relaxing', 'casual'],
  'point-and-click': ['point & click', 'point-and-click'],
  pointandclick: ['point & click', 'point-and-click'],
  visualnovel: ['visual novel'],
  cardgame: ['card game', 'card battler'],
  boardgame: ['board game'],
  beatemup: ["beat 'em up", 'beat em up'],
  hackandslash: ['hack and slash'],
});

/**
 * IGDB fallback map — used only when a game has no ITAD tags. Each entry
 * lists the canonical IGDB genre/theme IDs for that descriptor. Kept
 * small: the rich vocabulary lives in Steam tags, IGDB is a net.
 */
const IGDB_FALLBACK: Readonly<
  Record<string, { genreIds: number[]; themeIds: number[] }>
> = Object.freeze({
  action: { genreIds: [], themeIds: [1] },
  fantasy: { genreIds: [], themeIds: [17] },
  scifi: { genreIds: [], themeIds: [18] },
  horror: { genreIds: [], themeIds: [19] },
  thriller: { genreIds: [], themeIds: [20] },
  survival: { genreIds: [], themeIds: [21] },
  stealth: { genreIds: [], themeIds: [23] },
  comedy: { genreIds: [], themeIds: [27] },
  sandbox: { genreIds: [], themeIds: [33] },
  openworld: { genreIds: [], themeIds: [38] },
  warfare: { genreIds: [], themeIds: [39] },
  party: { genreIds: [], themeIds: [40] },
  '4x': { genreIds: [], themeIds: [41] },
  mystery: { genreIds: [], themeIds: [43] },
  romance: { genreIds: [], themeIds: [44] },
  paranormal: { genreIds: [], themeIds: [19, 43] },
  shooter: { genreIds: [5], themeIds: [] },
  fps: { genreIds: [5], themeIds: [] },
  platformer: { genreIds: [8], themeIds: [] },
  puzzle: { genreIds: [9], themeIds: [] },
  racing: { genreIds: [10], themeIds: [] },
  rts: { genreIds: [11], themeIds: [] },
  rpg: { genreIds: [12], themeIds: [] },
  simulation: { genreIds: [13], themeIds: [] },
  sport: { genreIds: [14], themeIds: [] },
  strategy: { genreIds: [15], themeIds: [] },
  tbs: { genreIds: [16], themeIds: [] },
  tactical: { genreIds: [24], themeIds: [] },
  adventure: { genreIds: [31], themeIds: [] },
  indie: { genreIds: [32], themeIds: [] },
  arcade: { genreIds: [33], themeIds: [] },
  visualnovel: { genreIds: [34], themeIds: [] },
  cardgame: { genreIds: [35], themeIds: [] },
  boardgame: { genreIds: [35], themeIds: [] },
  moba: { genreIds: [36], themeIds: [] },
  fighting: { genreIds: [4], themeIds: [] },
  mmorpg: { genreIds: [12], themeIds: [38] },
  mmo: { genreIds: [12], themeIds: [38] },
});

/** Normalise for lookup: lower, strip whitespace, strip separators. */
function canonicalize(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[_\s-]+/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Build a case-insensitive-friendly substring matcher from an LLM tag.
 * Uses synonyms when known, otherwise just the raw lowercased form —
 * which still works for most Steam tags ("Horror" contains "horror").
 */
function itadMatchersFor(tag: string): string[] {
  const key = canonicalize(tag);
  if (ITAD_SYNONYMS[key]) return ITAD_SYNONYMS[key];
  // Default: use the original tag lowercased+trimmed so the substring match
  // covers variants ("Horror", "Psychological Horror", "Survival Horror").
  return [tag.toLowerCase().trim()];
}

/**
 * Resolve a list of LLM-emitted tags into a filter set.
 * Returns empty arrays when `tags` is empty — the caller should treat
 * that as "no filter, use raw cosine result."
 */
export function resolveTagFilter(tags: string[] | undefined): TagFilterSet {
  if (!tags || tags.length === 0) return EMPTY;
  const itad = new Set<string>();
  const genres = new Set<number>();
  const themes = new Set<number>();
  for (const tag of tags) {
    for (const matcher of itadMatchersFor(tag)) itad.add(matcher);
    const fallback = IGDB_FALLBACK[canonicalize(tag)];
    if (fallback) {
      for (const id of fallback.genreIds) genres.add(id);
      for (const id of fallback.themeIds) themes.add(id);
    }
  }
  return {
    itadSubstrings: Array.from(itad),
    igdbGenreIds: Array.from(genres),
    igdbThemeIds: Array.from(themes),
  };
}

/**
 * True when a game passes the filter by EITHER route:
 *   - at least one itadTag (lowercased) contains one of the matcher
 *     substrings, OR
 *   - at least one games.genres overlaps the IGDB genre fallback, OR
 *   - at least one games.themes overlaps the IGDB theme fallback.
 * Empty filter → always true (callers should check filter emptiness
 * before invoking and skip the post-filter entirely).
 */
export function gameMatchesFilter(
  game: { itadTags: string[]; genres: number[]; themes: number[] },
  filter: TagFilterSet,
): boolean {
  if (filter.itadSubstrings.length > 0) {
    const lowered = game.itadTags.map((t) => t.toLowerCase());
    for (const sub of filter.itadSubstrings) {
      if (lowered.some((t) => t.includes(sub))) return true;
    }
  }
  if (filter.igdbGenreIds.length > 0) {
    if (game.genres.some((g) => filter.igdbGenreIds.includes(g))) return true;
  }
  if (filter.igdbThemeIds.length > 0) {
    if (game.themes.some((t) => filter.igdbThemeIds.includes(t))) return true;
  }
  return false;
}
