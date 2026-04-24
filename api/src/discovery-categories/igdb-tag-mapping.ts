/**
 * Map LLM-emitted string genre/theme tags to IGDB numeric IDs.
 * `games.genres` and `games.themes` both store IGDB IDs as number[], but the
 * LLM speaks in human strings like "horror" / "rpg" / "open-world".
 *
 * Each entry maps to a list of IDs across BOTH genre and theme ID spaces — so
 * a callsite can post-filter by either overlap. Unknown tags return no IDs
 * (caller should fall back to the raw cosine result).
 *
 * IGDB reference:
 *   https://api-docs.igdb.com/#genre    (genre IDs)
 *   https://api-docs.igdb.com/#theme    (theme IDs)
 */

export interface TagIds {
  genreIds: number[];
  themeIds: number[];
}

const EMPTY: TagIds = { genreIds: [], themeIds: [] };

const MAP: Readonly<Record<string, TagIds>> = Object.freeze({
  // Themes (top-row picks most LLMs reach for)
  action: { genreIds: [], themeIds: [1] },
  fantasy: { genreIds: [], themeIds: [17] },
  scifi: { genreIds: [], themeIds: [18] },
  'sci-fi': { genreIds: [], themeIds: [18] },
  'science-fiction': { genreIds: [], themeIds: [18] },
  horror: { genreIds: [], themeIds: [19] },
  spooky: { genreIds: [], themeIds: [19] },
  paranormal: { genreIds: [], themeIds: [19, 43] },
  thriller: { genreIds: [], themeIds: [20] },
  survival: { genreIds: [], themeIds: [21] },
  historical: { genreIds: [], themeIds: [22] },
  stealth: { genreIds: [], themeIds: [23] },
  comedy: { genreIds: [], themeIds: [27] },
  drama: { genreIds: [], themeIds: [31] },
  sandbox: { genreIds: [], themeIds: [33] },
  educational: { genreIds: [], themeIds: [34] },
  kids: { genreIds: [], themeIds: [35] },
  'open-world': { genreIds: [], themeIds: [38] },
  openworld: { genreIds: [], themeIds: [38] },
  warfare: { genreIds: [], themeIds: [39] },
  party: { genreIds: [], themeIds: [40] },
  '4x': { genreIds: [], themeIds: [41] },
  mystery: { genreIds: [], themeIds: [43] },
  romance: { genreIds: [], themeIds: [44] },

  // Genres
  shooter: { genreIds: [5], themeIds: [] },
  fps: { genreIds: [5], themeIds: [] },
  platformer: { genreIds: [8], themeIds: [] },
  platform: { genreIds: [8], themeIds: [] },
  puzzle: { genreIds: [9], themeIds: [] },
  racing: { genreIds: [10], themeIds: [] },
  rts: { genreIds: [11], themeIds: [] },
  'real-time-strategy': { genreIds: [11], themeIds: [] },
  rpg: { genreIds: [12], themeIds: [] },
  'role-playing': { genreIds: [12], themeIds: [] },
  roleplaying: { genreIds: [12], themeIds: [] },
  simulation: { genreIds: [13], themeIds: [] },
  simulator: { genreIds: [13], themeIds: [] },
  sport: { genreIds: [14], themeIds: [] },
  sports: { genreIds: [14], themeIds: [] },
  strategy: { genreIds: [15], themeIds: [] },
  'turn-based-strategy': { genreIds: [16], themeIds: [] },
  tbs: { genreIds: [16], themeIds: [] },
  tactical: { genreIds: [24], themeIds: [] },
  'hack-and-slash': { genreIds: [25], themeIds: [] },
  'beat-em-up': { genreIds: [25], themeIds: [] },
  adventure: { genreIds: [31], themeIds: [] },
  indie: { genreIds: [32], themeIds: [] },
  arcade: { genreIds: [33], themeIds: [] },
  'visual-novel': { genreIds: [34], themeIds: [] },
  'card-game': { genreIds: [35], themeIds: [] },
  'board-game': { genreIds: [35], themeIds: [] },
  moba: { genreIds: [36], themeIds: [] },
  fighting: { genreIds: [4], themeIds: [] },
  'point-and-click': { genreIds: [2], themeIds: [] },

  // MMORPG — no dedicated IGDB genre; approximate as RPG + open-world
  mmorpg: { genreIds: [12], themeIds: [38] },
  mmo: { genreIds: [12], themeIds: [38] },
});

/** Normalise a user/LLM tag for lookup: lower, strip whitespace, collapse separators. */
function normaliseTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Resolve a list of string tags to the union of their IGDB genre + theme IDs.
 * Unknown tags contribute nothing. Returns empty lists when no tags match —
 * caller should treat that case as "fall back to raw cosine result."
 */
export function resolveTagsToIgdbIds(tags: string[] | undefined): TagIds {
  if (!tags || tags.length === 0) return EMPTY;
  const genreIds = new Set<number>();
  const themeIds = new Set<number>();
  for (const tag of tags) {
    const entry = MAP[normaliseTag(tag)];
    if (!entry) continue;
    for (const id of entry.genreIds) genreIds.add(id);
    for (const id of entry.themeIds) themeIds.add(id);
  }
  return {
    genreIds: Array.from(genreIds),
    themeIds: Array.from(themeIds),
  };
}
