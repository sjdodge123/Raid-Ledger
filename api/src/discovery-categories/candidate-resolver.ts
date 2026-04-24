import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { executeSimilarityQuery } from '../game-taste/queries/similarity-queries';
import { resolveTagsToIgdbIds } from './igdb-tag-mapping';

type Db = PostgresJsDatabase<typeof schema>;

/** Mirrors `DEFAULT_MIN_CONFIDENCE` in similarity-queries — zero-signal filter. */
const MIN_CONFIDENCE = 0.0001;

export interface ResolveCandidatesOptions {
  limit: number;
  /** Optional IGDB genre IDs (`games.genres`) for hybrid-strategy post-filter. */
  genreIds?: number[];
  /** Optional IGDB theme IDs (`games.themes`) for hybrid-strategy post-filter. */
  themeIds?: number[];
  /**
   * Optional LLM-emitted string tags (e.g. "horror", "rpg", "open-world").
   * Resolved via `resolveTagsToIgdbIds` and merged with `genreIds`/`themeIds`.
   * Unknown tags are ignored.
   */
  tags?: string[];
}

/**
 * Resolve the top-N game IDs most similar (by pgvector cosine distance) to a
 * blended theme vector. When genre/theme IDs are supplied (directly or via
 * resolved `tags`) the vector result is post-filtered in-memory so hybrid
 * categories can narrow to a niche without rewriting the SQL.
 */
export async function resolveCandidates(
  db: Db,
  themeVector: number[],
  opts: ResolveCandidatesOptions,
): Promise<number[]> {
  const resolved = resolveTagsToIgdbIds(opts.tags);
  const genreIds = dedupe([...(opts.genreIds ?? []), ...resolved.genreIds]);
  const themeIds = dedupe([...(opts.themeIds ?? []), ...resolved.themeIds]);
  const hasFilter = genreIds.length > 0 || themeIds.length > 0;

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
  return postFilterByTaxonomy(db, rows, genreIds, themeIds, opts.limit);
}

function dedupe(ids: number[]): number[] {
  return Array.from(new Set(ids));
}

async function postFilterByTaxonomy(
  db: Db,
  rows: { game_id: number }[],
  genreIds: number[],
  themeIds: number[],
  limit: number,
): Promise<number[]> {
  const ids = rows.map((r) => r.game_id);
  if (ids.length === 0) return [];
  const games = await db
    .select({
      id: schema.games.id,
      genres: schema.games.genres,
      themes: schema.games.themes,
    })
    .from(schema.games)
    .where(inArray(schema.games.id, ids));
  const genreSet = new Set(genreIds);
  const themeSet = new Set(themeIds);
  const taxonomyById = new Map<
    number,
    { genres: number[]; themes: number[] }
  >(
    games.map((g) => [
      g.id,
      { genres: g.genres ?? [], themes: g.themes ?? [] },
    ]),
  );
  const out: number[] = [];
  for (const r of rows) {
    const tax = taxonomyById.get(r.game_id);
    if (!tax) continue;
    const genreMatch =
      genreSet.size === 0 || tax.genres.some((g) => genreSet.has(g));
    const themeMatch =
      themeSet.size === 0 || tax.themes.some((t) => themeSet.has(t));
    if (genreMatch && themeMatch) out.push(r.game_id);
    if (out.length >= limit) break;
  }
  return out;
}
