import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GameDiscoverRowDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { mapDbRowToDetail } from '../igdb/igdb.mappers';
import { VISIBILITY_FILTER } from '../igdb/igdb-visibility.helpers';
import { resolveCandidates } from './candidate-resolver';

type Db = PostgresJsDatabase<typeof schema>;

interface ApprovedRow {
  id: string;
  name: string;
  themeVector: number[];
  candidateGameIds: number[];
  populationStrategy: string;
  filterCriteria: Record<string, unknown>;
  sortOrder: number;
}

/** How many games to surface per dynamic row. */
const DYNAMIC_ROW_LIMIT = 20;

/**
 * Load the set of approved + non-expired dynamic categories and render each
 * as a `GameDiscoverRowDto`. Dispatched per `population_strategy`:
 *   - `fixed`  → use the pre-resolved `candidate_game_ids` as-is.
 *   - `vector` → live similarity query against `game_taste_vectors`.
 *   - `hybrid` → vector similarity post-filtered by numeric genre IDs
 *                (LLM-emitted string tags are ignored in v1 — see
 *                `candidate-resolver.ts` for the mapping TODO).
 *
 * Rows are ordered by their stored `sort_order` so the discover controller
 * can merge them into the static list by the same column.
 */
export async function loadApprovedDynamicRows(
  db: Db,
): Promise<GameDiscoverRowDto[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: schema.discoveryCategorySuggestions.id,
      name: schema.discoveryCategorySuggestions.name,
      themeVector: schema.discoveryCategorySuggestions.themeVector,
      candidateGameIds: schema.discoveryCategorySuggestions.candidateGameIds,
      populationStrategy: schema.discoveryCategorySuggestions.populationStrategy,
      filterCriteria: schema.discoveryCategorySuggestions.filterCriteria,
      sortOrder: schema.discoveryCategorySuggestions.sortOrder,
    })
    .from(schema.discoveryCategorySuggestions)
    .where(
      and(
        eq(schema.discoveryCategorySuggestions.status, 'approved'),
        or(
          isNull(schema.discoveryCategorySuggestions.expiresAt),
          gt(schema.discoveryCategorySuggestions.expiresAt, now),
        ),
      ),
    )
    .orderBy(asc(schema.discoveryCategorySuggestions.sortOrder));

  const out: GameDiscoverRowDto[] = [];
  for (const raw of rows) {
    const row: ApprovedRow = {
      ...raw,
      filterCriteria: (raw.filterCriteria ?? {}) as Record<string, unknown>,
    };
    const games = await resolveRowGames(db, row);
    if (games.length === 0) continue;
    out.push({
      category: row.name,
      slug: `dynamic-${row.id}`,
      games,
      suggestionId: row.id,
      isDynamic: true as const,
    });
  }
  return out;
}

async function resolveRowGames(
  db: Db,
  row: ApprovedRow,
): Promise<GameDiscoverRowDto['games']> {
  if (row.populationStrategy === 'fixed') {
    return hydrateGameIds(db, row.candidateGameIds.slice(0, DYNAMIC_ROW_LIMIT));
  }
  const genreIds = extractGenreIds(row.filterCriteria);
  const ids = await resolveCandidates(db, row.themeVector, {
    limit: DYNAMIC_ROW_LIMIT,
    genreIds: row.populationStrategy === 'hybrid' ? genreIds : undefined,
  });
  return hydrateGameIds(db, ids);
}

function extractGenreIds(
  filterCriteria: Record<string, unknown>,
): number[] | undefined {
  const raw = filterCriteria['genre_ids'];
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is number => typeof v === 'number');
  return ids.length > 0 ? ids : undefined;
}

async function hydrateGameIds(
  db: Db,
  ids: number[],
): Promise<GameDiscoverRowDto['games']> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(schema.games)
    .where(and(inArray(schema.games.id, ids), VISIBILITY_FILTER()));
  const byId = new Map(rows.map((g) => [g.id, g]));
  return ids
    .map((id) => byId.get(id))
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .map((g) => mapDbRowToDetail(g));
}
