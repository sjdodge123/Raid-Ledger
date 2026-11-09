/**
 * ROK-2121: fire `onGameChanged` (→ game-taste-vector recompute) only when a
 * game's taste inputs actually changed.
 *
 * `recomputeGameVector` reads exactly four columns of `games` (via
 * `taste-profile/pipelines/aggregate-vectors-loaders.ts::metadataQuery`):
 * `genres`, `game_modes`, `themes` and `itad_tags` (tags lowercased, null
 * treated as an empty list; `hashList` sorts, so order never matters). The
 * 6-hourly IGDB sync rewrites every row it touches, so without this diff it
 * enqueued ~5,300 recomputes per sync for rows whose inputs were unchanged.
 *
 * The daily `aggregateGameVectors` cron stays the backstop for anything this
 * diff misses.
 */
import { inArray, or, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** The four `games` columns a taste vector reads. Typed loosely: jsonb. */
export interface TasteInputs {
  genres: unknown;
  gameModes: unknown;
  themes: unknown;
  itadTags: unknown;
}

/** Identifiers the IGDB batch upsert matches existing rows by. */
export interface UpsertRowIdentity {
  igdbId?: number | null | undefined;
  steamAppId?: number | null | undefined;
}

/** Order-insensitive, null-tolerant list key; `lower` folds string case. */
function listKey(value: unknown, lower = false): string[] {
  if (!Array.isArray(value)) return [];
  const items = value.map((v) => (lower ? String(v).toLowerCase() : String(v)));
  return items.sort();
}

/** Canonical comparison key for a row's taste inputs. */
export function tasteInputKey(row: TasteInputs): string {
  return JSON.stringify([
    listKey(row.genres),
    listKey(row.gameModes),
    listKey(row.themes),
    listKey(row.itadTags, true),
  ]);
}

/**
 * ITAD enrichment: did the tags change? `next === undefined` means the info
 * call failed and the stored tags are kept, so nothing changed.
 */
export function itadTagsChanged(
  stored: unknown,
  next: string[] | undefined,
): boolean {
  if (next === undefined) return false;
  const before = JSON.stringify(listKey(stored, true));
  return before !== JSON.stringify(listKey(next, true));
}

/**
 * Ids of `after` rows whose taste inputs differ from the `before` snapshot.
 * A row missing from the snapshot (a fresh insert, or a name-merge target the
 * snapshot did not cover) counts as changed.
 */
export function changedTasteInputIds(
  before: ReadonlyMap<number, string>,
  after: ReadonlyArray<TasteInputs & { id: number }>,
): number[] {
  return after
    .filter((row) => before.get(row.id) !== tasteInputKey(row))
    .map((row) => row.id);
}

function identityFilter(rows: readonly UpsertRowIdentity[]): SQL | undefined {
  const igdbIds = rows
    .map((r) => r.igdbId)
    .filter((id): id is number => id != null);
  const steamAppIds = rows
    .map((r) => r.steamAppId)
    .filter((id): id is number => id != null);
  const clauses: SQL[] = [];
  if (igdbIds.length > 0) clauses.push(inArray(schema.games.igdbId, igdbIds));
  if (steamAppIds.length > 0) {
    clauses.push(inArray(schema.games.steamAppId, steamAppIds));
  }
  return clauses.length > 0 ? or(...clauses) : undefined;
}

/**
 * Snapshot the taste inputs of every existing row the batch upsert can match
 * by igdbId or steamAppId, keyed by game id.
 */
export async function snapshotTasteInputs(
  db: Db,
  rows: readonly UpsertRowIdentity[],
): Promise<Map<number, string>> {
  const filter = identityFilter(rows);
  const snapshot = new Map<number, string>();
  if (!filter) return snapshot;
  const existing = await db
    .select({
      id: schema.games.id,
      genres: schema.games.genres,
      gameModes: schema.games.gameModes,
      themes: schema.games.themes,
      itadTags: schema.games.itadTags,
    })
    .from(schema.games)
    .where(filter);
  for (const row of existing) snapshot.set(row.id, tasteInputKey(row));
  return snapshot;
}

/**
 * Run `write` (the batch upsert) between a before-snapshot and an after-diff.
 * With `track` false (no `onGameChanged` listener) it skips the snapshot
 * query and reports no changes.
 */
export async function withTasteInputDiff<
  T extends TasteInputs & { id: number },
>(
  db: Db,
  rows: readonly UpsertRowIdentity[],
  write: () => Promise<T[]>,
  track: boolean,
): Promise<{ results: T[]; changedIds: number[] }> {
  if (!track) return { results: await write(), changedIds: [] };
  const before = await snapshotTasteInputs(db, rows);
  const results = await write();
  return { results, changedIds: changedTasteInputIds(before, results) };
}

/**
 * Wrap a per-game callback so each id fires at most once per sync run —
 * refresh, discover and ITAD enrichment can all touch the same game.
 */
export function oncePerGame(
  fn: (gameId: number) => void,
): (gameId: number) => void {
  const seen = new Set<number>();
  return (gameId) => {
    if (seen.has(gameId)) return;
    seen.add(gameId);
    fn(gameId);
  };
}
