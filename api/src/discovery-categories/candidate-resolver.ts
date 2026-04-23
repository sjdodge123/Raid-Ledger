import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { executeSimilarityQuery } from '../game-taste/queries/similarity-queries';

type Db = PostgresJsDatabase<typeof schema>;

/** Mirrors `DEFAULT_MIN_CONFIDENCE` in similarity-queries — zero-signal filter. */
const MIN_CONFIDENCE = 0.0001;

export interface ResolveCandidatesOptions {
  limit: number;
  /** Optional genre IGDB IDs (numbers) for hybrid-strategy post-filtering. */
  genreIds?: number[];
}

/**
 * Resolve the top-N game IDs most similar (by pgvector cosine distance) to a
 * blended theme vector. When `genreIds` is present the vector result is
 * post-filtered in-memory by `games.genres` overlap so hybrid categories can
 * narrow to a niche without rewriting the SQL.
 *
 * NOTE: v1 hybrid filter keys on IGDB genre IDs (`games.genres: number[]`).
 * The LLM emits string genre_tags which a future mapping layer (ROK follow-up)
 * will resolve to IDs; for now callers only get post-filtering if they can
 * supply numeric IDs, otherwise the strategy behaves identically to `vector`.
 */
export async function resolveCandidates(
  db: Db,
  themeVector: number[],
  opts: ResolveCandidatesOptions,
): Promise<number[]> {
  const fetchLimit =
    opts.genreIds && opts.genreIds.length > 0 ? opts.limit * 4 : opts.limit;
  const rows = await executeSimilarityQuery(
    db,
    themeVector,
    fetchLimit,
    MIN_CONFIDENCE,
    null,
    false,
  );
  if (!opts.genreIds || opts.genreIds.length === 0) {
    return rows.slice(0, opts.limit).map((r) => r.game_id);
  }
  return postFilterByGenres(db, rows, opts.genreIds, opts.limit);
}

async function postFilterByGenres(
  db: Db,
  rows: { game_id: number }[],
  genreIds: number[],
  limit: number,
): Promise<number[]> {
  const ids = rows.map((r) => r.game_id);
  if (ids.length === 0) return [];
  const games = await db
    .select({
      id: schema.games.id,
      genres: schema.games.genres,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  const genreSet = new Set(genreIds);
  const genreById = new Map<number, number[]>(
    games.map((g) => [g.id, g.genres ?? []]),
  );
  const out: number[] = [];
  for (const r of rows) {
    const gs = genreById.get(r.game_id) ?? [];
    if (gs.some((g) => genreSet.has(g))) out.push(r.game_id);
    if (out.length >= limit) break;
  }
  return out;
}
