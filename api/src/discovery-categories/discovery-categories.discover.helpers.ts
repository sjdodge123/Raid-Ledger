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
      populationStrategy:
        schema.discoveryCategorySuggestions.populationStrategy,
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

  // Each approved row triggers 2-3 DB round-trips (cosine search, optional
  // post-filter, hydrate). Fan the rows out via Promise.all so /games/discover
  // doesn't degrade linearly with the approved count.
  const resolved = await Promise.all(
    rows.map(async (raw) => {
      const row: ApprovedRow = {
        ...raw,
        filterCriteria: (raw.filterCriteria ?? {}) as Record<string, unknown>,
      };
      const games = await resolveRowGames(db, row);
      return { row, games };
    }),
  );
  return resolved
    .filter(({ games }) => games.length > 0)
    .map(({ row, games }) => ({
      category: row.name,
      slug: `dynamic-${row.id}`,
      games,
      suggestionId: row.id,
      isDynamic: true as const,
    }));
}

async function resolveRowGames(
  db: Db,
  row: ApprovedRow,
): Promise<GameDiscoverRowDto['games']> {
  if (row.populationStrategy === 'fixed') {
    return hydrateGameIds(db, row.candidateGameIds.slice(0, DYNAMIC_ROW_LIMIT));
  }
  // Always honour the LLM's genre_tags / explicit genre_ids / theme_ids —
  // when present they narrow the cosine result to the category's actual
  // intent (e.g. "horror" = IGDB theme 19). vector strategy also benefits,
  // not just hybrid: the LLM labeled `vector` is still stating intent.
  const genreIds = extractIdArray(row.filterCriteria, 'genre_ids');
  const themeIds = extractIdArray(row.filterCriteria, 'theme_ids');
  const tags = extractStringArray(row.filterCriteria, 'genre_tags');
  const ids = await resolveCandidates(db, row.themeVector, {
    limit: DYNAMIC_ROW_LIMIT,
    genreIds,
    themeIds,
    tags,
  });
  return hydrateGameIds(db, ids);
}

function extractIdArray(
  filterCriteria: Record<string, unknown>,
  key: string,
): number[] | undefined {
  const raw = filterCriteria[key];
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((v): v is number => typeof v === 'number');
  return ids.length > 0 ? ids : undefined;
}

function extractStringArray(
  filterCriteria: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const raw = filterCriteria[key];
  if (!Array.isArray(raw)) return undefined;
  const tags = raw.filter((v): v is string => typeof v === 'string');
  return tags.length > 0 ? tags : undefined;
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
