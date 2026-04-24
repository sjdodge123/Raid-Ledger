import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { executeSimilarityQuery } from '../game-taste/queries/similarity-queries';
import {
  resolveTagFilter,
  scoreGameMatch,
  type TagFilterSet,
} from './tag-mapping';

type Db = PostgresJsDatabase<typeof schema>;

/** Mirrors `DEFAULT_MIN_CONFIDENCE` in similarity-queries — zero-signal filter. */
const MIN_CONFIDENCE = 0.0001;

export interface ResolveCandidatesOptions {
  limit: number;
  /** LLM-emitted descriptor tags (primary filter — ITAD/Steam tags first). */
  tags?: string[];
  /** Optional explicit IGDB genre IDs — merged with the fallback from tags. */
  genreIds?: number[];
  /** Optional explicit IGDB theme IDs — merged with the fallback from tags. */
  themeIds?: number[];
}

/**
 * Resolve the top-N game IDs most similar (by pgvector cosine distance) to a
 * blended theme vector. When filter tags are present, the vector result is
 * post-filtered against ITAD/Steam tags first, falling back to IGDB
 * genre/theme IDs for games that have no ITAD tag data yet.
 */
export async function resolveCandidates(
  db: Db,
  themeVector: number[],
  opts: ResolveCandidatesOptions,
): Promise<number[]> {
  const filter = mergeFilter(opts);
  const hasFilter =
    filter.itadSubstrings.length > 0 ||
    filter.igdbGenreIds.length > 0 ||
    filter.igdbThemeIds.length > 0;

  const fetchLimit = hasFilter ? opts.limit * 5 : opts.limit;
  const rows = await executeSimilarityQuery(
    db,
    themeVector,
    fetchLimit,
    MIN_CONFIDENCE,
    null,
    false,
  );
  if (!hasFilter) {
    return rows.slice(0, opts.limit).map((r) => r.game_id);
  }
  return postFilter(db, rows, filter, opts.limit);
}

function mergeFilter(opts: ResolveCandidatesOptions): TagFilterSet {
  const resolved = resolveTagFilter(opts.tags);
  return {
    itadSubstrings: resolved.itadSubstrings,
    igdbGenreIds: dedupe([...(opts.genreIds ?? []), ...resolved.igdbGenreIds]),
    igdbThemeIds: dedupe([...(opts.themeIds ?? []), ...resolved.igdbThemeIds]),
  };
}

function dedupe(ids: number[]): number[] {
  return Array.from(new Set(ids));
}

async function postFilter(
  db: Db,
  rows: { game_id: number }[],
  filter: TagFilterSet,
  limit: number,
): Promise<number[]> {
  const ids = rows.map((r) => r.game_id);
  if (ids.length === 0) return [];
  const games = await db
    .select({
      id: schema.games.id,
      itadTags: schema.games.itadTags,
      genres: schema.games.genres,
      themes: schema.games.themes,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  const byId = new Map<
    number,
    { itadTags: string[]; genres: number[]; themes: number[] }
  >(
    games.map((g) => [
      g.id,
      {
        itadTags: g.itadTags ?? [],
        genres: g.genres ?? [],
        themes: g.themes ?? [],
      },
    ]),
  );
  // Keep only games that match at least ONE matcher; rank by how many
  // matchers they hit so a [horror, co-op, paranormal] filter surfaces
  // Dead by Daylight (hits all three) above a pure co-op game (hits one).
  // Ties fall back to the original cosine order (stable sort).
  type Ranked = { gameId: number; score: number; idx: number };
  const ranked: Ranked[] = [];
  rows.forEach((r, idx) => {
    const meta = byId.get(r.game_id);
    if (!meta) return;
    const score = scoreGameMatch(meta, filter);
    if (score > 0) ranked.push({ gameId: r.game_id, score, idx });
  });
  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return ranked.slice(0, limit).map((r) => r.gameId);
}
