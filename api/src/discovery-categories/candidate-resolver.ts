import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { executeSimilarityQuery } from '../game-taste/queries/similarity-queries';
import {
  resolveTagFilter,
  scoreGameMatch,
  tagsImplyMultiplayer,
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
  /**
   * When true, reject games whose games.player_count.max < 2. Auto-inferred
   * from `tags` via `tagsImplyMultiplayer` when not set explicitly. Prevents
   * a "Co-op Weekends" row from surfacing solo-only titles just because
   * their ITAD tag soup happens to contain "Multiplayer" or similar.
   */
  requireMultiplayer?: boolean;
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
  const requireMultiplayer =
    opts.requireMultiplayer ?? tagsImplyMultiplayer(opts.tags);

  // Widen the fetch when we're post-filtering so a strict multiplayer or
  // tag filter doesn't starve the result set.
  const fetchLimit =
    hasFilter || requireMultiplayer ? opts.limit * 5 : opts.limit;
  const rows = await executeSimilarityQuery(
    db,
    themeVector,
    fetchLimit,
    MIN_CONFIDENCE,
    null,
    false,
  );
  if (!hasFilter && !requireMultiplayer) {
    return rows.slice(0, opts.limit).map((r) => r.game_id);
  }
  return postFilter(db, rows, filter, opts.limit, requireMultiplayer);
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

interface GameTaxonomy {
  itadTags: string[];
  genres: number[];
  themes: number[];
  playerCount: { min: number; max: number } | null;
}

async function postFilter(
  db: Db,
  rows: { game_id: number }[],
  filter: TagFilterSet,
  limit: number,
  requireMultiplayer: boolean,
): Promise<number[]> {
  const ids = rows.map((r) => r.game_id);
  if (ids.length === 0) return [];
  const games = await db
    .select({
      id: schema.games.id,
      itadTags: schema.games.itadTags,
      genres: schema.games.genres,
      themes: schema.games.themes,
      playerCount: schema.games.playerCount,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  const byId = new Map<number, GameTaxonomy>(
    games.map((g) => [
      g.id,
      {
        itadTags: g.itadTags ?? [],
        genres: g.genres ?? [],
        themes: g.themes ?? [],
        playerCount: g.playerCount ?? null,
      },
    ]),
  );
  const hasTagFilter =
    filter.itadSubstrings.length > 0 ||
    filter.igdbGenreIds.length > 0 ||
    filter.igdbThemeIds.length > 0;
  // Keep games that satisfy BOTH the multiplayer gate (if set) AND — when
  // tags exist — match at least ONE matcher; rank by tag-match count so a
  // [horror, co-op, paranormal] filter surfaces Dead by Daylight (hits all
  // three) above a pure co-op game (hits one). Ties fall back to cosine
  // order (stable sort).
  type Ranked = { gameId: number; score: number; idx: number };
  const ranked: Ranked[] = [];
  rows.forEach((r, idx) => {
    const meta = byId.get(r.game_id);
    if (!meta) return;
    if (requireMultiplayer && !isMultiplayer(meta.playerCount)) return;
    const score = hasTagFilter ? scoreGameMatch(meta, filter) : 1;
    if (score > 0) ranked.push({ gameId: r.game_id, score, idx });
  });
  ranked.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return ranked.slice(0, limit).map((r) => r.gameId);
}

/** A game qualifies as multiplayer when we know max > 1. Missing player_count
 *  is treated as unknown → rejected so multiplayer categories stay clean. */
function isMultiplayer(pc: { min: number; max: number } | null): boolean {
  if (!pc) return false;
  return typeof pc.max === 'number' && pc.max >= 2;
}
