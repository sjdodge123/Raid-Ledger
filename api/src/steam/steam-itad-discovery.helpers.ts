/**
 * ITAD-primary game discovery helpers for Steam library sync (ROK-774).
 * When a Steam game isn't in the DB, looks it up via ITAD and creates a game row.
 */
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadGame } from '../itad/itad.constants';
import type { IgdbApiGame } from '../igdb/igdb.constants';
import {
  enrichFromIgdb,
  type IgdbEnrichmentData,
} from './steam-igdb-enrichment.helpers';
import { checkAdultContent } from './steam-content-filter.helpers';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';
import { defined } from '../common/defined.helpers';

const logger = new Logger('SteamItadDiscovery');

/** Check whether an ITAD game is a standalone game (not DLC/bundle/soundtrack). */
export function isFullGame(itadGame: ItadGame): boolean {
  return itadGame.type === 'game';
}

/** Type for a games table insert row. */
type GameInsertRow = typeof schema.games.$inferInsert;

/**
 * A row discovery matched, with the moderation state the merge must respect
 * (ROK-1843). Absent flags read as "not moderated".
 */
interface MatchedGame {
  id: number;
  hidden?: boolean | undefined;
  banned?: boolean | undefined;
}

/** What discovery stored: the row id and its hidden flag after the write. */
interface StoredGame {
  id: number;
  hidden: boolean;
}

/** Dependencies injected into the discovery pipeline. */
export interface DiscoveryDeps {
  db: PostgresJsDatabase<typeof schema>;
  lookupBySteamAppId: (appId: number) => Promise<ItadGame | null>;
  queryIgdb?: ((body: string) => Promise<IgdbApiGame[]>) | undefined;
  adultFilterEnabled: boolean;
}

/**
 * Where the Steam app id a discovery writes came from (ROK-1680). The caller
 * decides: an id read off a Steam API response is 'steam'; an id a user
 * supplied and ITAD resolved is 'itad'.
 */
export type DiscoverySteamAppIdSource = 'steam' | 'itad';

/** Result of discovering a single game via ITAD. */
export interface DiscoveryResult {
  gameId: number;
  source: 'itad' | 'itad+igdb';
  hidden: boolean;
}

/** Build a game row from ITAD data only. */
function buildItadGameRow(
  itadGame: ItadGame,
  steamAppId: number,
  steamAppIdSource: DiscoverySteamAppIdSource,
): GameInsertRow {
  return {
    name: itadGame.title,
    slug: itadGame.slug,
    steamAppId,
    steamAppIdSource,
    itadGameId: itadGame.id || null,
    coverUrl: itadGame.assets?.boxart ?? null,
    hidden: false,
    banned: false,
  };
}

/** Merge IGDB enrichment data into a game row. */
function mergeIgdbEnrichment(
  row: GameInsertRow,
  igdb: IgdbEnrichmentData,
): GameInsertRow {
  return {
    ...row,
    igdbId: igdb.igdbId,
    coverUrl: igdb.coverUrl ?? row.coverUrl,
    summary: igdb.summary,
    rating: igdb.rating,
    aggregatedRating: igdb.aggregatedRating,
    genres: igdb.genres,
    themes: igdb.themes,
    gameModes: igdb.gameModes,
    platforms: igdb.platforms,
    screenshots: igdb.screenshots,
    videos: igdb.videos,
    firstReleaseDate: igdb.firstReleaseDate,
    slug: igdb.slug || row.slug,
  };
}

/**
 * Try to merge with an existing game by slug or itadGameId, or insert a new row.
 *
 * ROK-1438: the whole find-then-insert runs under an advisory lock keyed on the
 * normalized name. Steam library syncs run concurrently per user, so two members
 * owning the same title used to be able to both read-miss and both insert.
 */
async function upsertGame(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<StoredGame | null> {
  return withGameNameLock(db, row.name ?? '', (tx) =>
    upsertGameLocked(tx, row),
  );
}

/**
 * Find-then-insert body. MUST run inside the name lock. Returns null when the
 * matched row is banned (ROK-1843): nothing is written and nothing returned.
 */
async function upsertGameLocked(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<StoredGame | null> {
  const bySlug = await db.query.games.findFirst({
    where: eq(schema.games.slug, row.slug ?? ''),
    columns: { id: true, steamAppId: true, hidden: true, banned: true },
  });

  if (bySlug) {
    // Slug taken by a different Steam game — skip itadGameId merge and create
    // a new row with a suffixed slug + nulled unique fields.
    if (bySlug.steamAppId && bySlug.steamAppId !== row.steamAppId) {
      return insertSlugTwin(db, bySlug, row);
    }
    return mergeIntoExisting(db, bySlug, row);
  }

  // Check for itadGameId collision before inserting
  const byItad = row.itadGameId
    ? await findByItadGameId(db, row.itadGameId)
    : null;
  if (byItad) return mergeIntoExisting(db, byItad, row);

  // ROK-1113: collapse normalized-name duplicates (e.g., "Slay the Spire 2" vs
  // "Slay the Spire II") into a single row instead of inserting a parallel one.
  const byNormalized = await findByNormalizedName(db, row);
  if (byNormalized) return mergeIntoExisting(db, byNormalized, row);

  return insertNewGame(db, row);
}

/**
 * Insert a suffixed-slug twin of a row another Steam app owns. ROK-1843: the
 * twin inherits the original's moderation — a banned original yields no twin,
 * a hidden one a hidden twin — so a second Steam app id that ITAD maps to the
 * same game can't bring a moderated game back as a visible duplicate.
 */
async function insertSlugTwin(
  db: PostgresJsDatabase<typeof schema>,
  original: MatchedGame,
  row: GameInsertRow,
): Promise<StoredGame | null> {
  if (original.banned === true) return null;
  if (original.hidden !== true) return insertNewGame(db, row);
  return insertNewGame(db, { ...row, hidden: true });
}

/** Insert a brand-new row; its hidden flag is the one discovery computed. */
async function insertNewGame(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<StoredGame> {
  const [inserted] = await insertAvoidingUniqueCollisions(db, row);
  return {
    id: defined(inserted, 'inserted game row').id,
    hidden: row.hidden === true,
  };
}

/**
 * Look up an existing row by normalized name, refusing to merge if both rows
 * have non-null igdbIds that disagree (sequel/variant signal).
 */
async function findByNormalizedName(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<MatchedGame | null> {
  if (!row.name) return null;
  const match = await findGameByNormalizedName(db, row.name);
  if (!match) return null;
  if (
    row.igdbId != null &&
    match.igdbId != null &&
    match.igdbId !== row.igdbId
  ) {
    return null;
  }
  return { id: match.id, hidden: match.hidden, banned: match.banned };
}

/** Find a game by its ITAD game ID. */
async function findByItadGameId(
  db: PostgresJsDatabase<typeof schema>,
  itadGameId: string,
): Promise<MatchedGame | null> {
  const found = await db.query.games.findFirst({
    where: eq(schema.games.itadGameId, itadGameId),
    columns: { id: true, hidden: true, banned: true },
  });
  return found ?? null;
}

/**
 * Merge discovery data into an existing game row.
 *
 * ROK-1843 — moderation is admin-only, so a merge never weakens it:
 * - a banned match is skipped entirely (no write, null result);
 * - `hidden` only ever moves false → true (stored = existing OR row), and the
 *   write is a literal `true` so a concurrent admin hide can't be undone;
 * - a non-null `itadGameId` is kept (COALESCE), never overwritten.
 */
async function mergeIntoExisting(
  db: PostgresJsDatabase<typeof schema>,
  existing: MatchedGame,
  row: GameInsertRow,
): Promise<StoredGame | null> {
  if (existing.banned === true) {
    logger.debug(`Skipped merge into banned game ${existing.id}`);
    return null;
  }
  const g = schema.games;
  await db
    .update(g)
    .set({
      steamAppId: row.steamAppId,
      steamAppIdSource: row.steamAppIdSource,
      itadGameId: sql`COALESCE(${g.itadGameId}, ${row.itadGameId ?? null})`,
      coverUrl: row.coverUrl ?? undefined,
      ...(row.hidden === true ? { hidden: true } : {}),
    })
    .where(eq(g.id, existing.id));
  logger.debug(`Merged ITAD data into existing game ${existing.id}`);
  return {
    id: existing.id,
    hidden: existing.hidden === true || row.hidden === true,
  };
}

/**
 * Insert a new game row, falling back to a suffixed slug if any unique key is
 * already taken.
 *
 * Three constraints shaped this, in order:
 *
 * 1. The original code INSERTed optimistically and CAUGHT the 23505 to retry.
 *    That stopped working once the caller moved inside a transaction
 *    (ROK-1438) — under postgres.js a failed statement poisons the whole
 *    transaction, so the catch has no usable connection left to retry on.
 *    Same trap `safeReassign`'s savepoint hit in ROK-1437.
 * 2. Replacing it with a SELECT probe was racy: two discoveries for DIFFERENT
 *    normalized names can share a unique key (ITAD returning the same slug for
 *    two editions), so they take different name locks, both probe clean, and
 *    the second insert still raises (Codex pre-push review, P2).
 * 3. `ON CONFLICT DO NOTHING` is neither: a conflict is not an error, so it
 *    never poisons the transaction, and the DATABASE decides atomically rather
 *    than a probe guessing ahead of it. An empty RETURNING means some unique
 *    key collided — then, and only then, insert the suffixed row.
 *
 * The suffixed row is identical to what the old retry produced: slug suffixed
 * with the Steam app id, itadGameId/igdbId nulled so they can't collide either.
 */
async function insertAvoidingUniqueCollisions(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<{ id: number }[]> {
  const inserted = await insertIfNoConflict(db, row);
  if (inserted.length > 0) return inserted;

  const suffixed = await insertIfNoConflict(db, {
    ...row,
    slug: `${row.slug}-${row.steamAppId}`,
    itadGameId: null,
    igdbId: null,
  });
  if (suffixed.length > 0) return suffixed;

  // Only reachable when the collision is on a key the suffixed row keeps —
  // in practice steamAppId, which the old retry could not recover from either.
  // Fail loudly rather than returning an empty array the caller would index
  // into and crash on with a confusing `undefined.id`.
  throw new Error(
    `Unresolvable unique collision inserting game "${row.name}" ` +
      `(slug=${row.slug}, steamAppId=${row.steamAppId})`,
  );
}

/** INSERT ... ON CONFLICT DO NOTHING. Empty result = some unique key collided. */
function insertIfNoConflict(
  db: PostgresJsDatabase<typeof schema>,
  values: GameInsertRow,
): Promise<{ id: number }[]> {
  return db
    .insert(schema.games)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: schema.games.id });
}

/** PG error fields extracted from a postgres.js error or its cause chain. */
export interface PgErrorDetail {
  code: string;
  detail: string;
  constraint: string;
}

/**
 * Walk an error/cause chain and extract PG error fields if present.
 * postgres.js puts code/detail/constraint on the error or its cause.
 */
export function extractPgErrorDetail(err: unknown): PgErrorDetail | null {
  if (typeof err !== 'object' || err === null) return null;
  const obj = err as Record<string, unknown>;
  if (typeof obj.code === 'string' && typeof obj.detail === 'string') {
    return {
      code: obj.code,
      detail: obj.detail,
      constraint: typeof obj.constraint === 'string' ? obj.constraint : '',
    };
  }
  if ('cause' in obj) return extractPgErrorDetail(obj.cause);
  return null;
}

/** Apply the adult content filter and set hidden flag if needed. */
function applyAdultFilter(
  gameName: string,
  itadMature: boolean,
  adultFilterEnabled: boolean,
  igdbThemes?: number[],
): boolean {
  if (!adultFilterEnabled) return false;
  const result = checkAdultContent(gameName, itadMature, igdbThemes);
  if (result.isAdult) {
    logger.debug(`Adult filter: hiding "${gameName}" (${result.reason})`);
  }
  return result.isAdult;
}

/**
 * Discover a single game via ITAD, optionally enrich from IGDB,
 * insert into DB, and return the new game ID.
 * Returns null if the game is banned or ITAD lookup fails.
 * `steamAppIdSource` is required with no default so every caller has to say
 * where its Steam id came from (ROK-1680); it rides on the insert, the
 * suffixed-slug retry and the merge.
 */
export async function discoverGameViaItad(
  steamAppId: number,
  deps: DiscoveryDeps,
  steamAppIdSource: DiscoverySteamAppIdSource,
): Promise<DiscoveryResult | null> {
  const itadGame = await deps.lookupBySteamAppId(steamAppId);
  if (!itadGame) return null;

  if (!isFullGame(itadGame)) return null; // Skip DLC/expansion items

  // Check if game is already banned by slug
  if (await isBannedBySlug(deps.db, itadGame.slug)) return null;

  let row = buildItadGameRow(itadGame, steamAppId, steamAppIdSource);
  let source: DiscoveryResult['source'] = 'itad';
  let igdbThemes: number[] | undefined;

  // Optionally enrich from IGDB
  if (deps.queryIgdb) {
    const igdb = await enrichFromIgdb(steamAppId, deps.queryIgdb);
    if (igdb) {
      row = mergeIgdbEnrichment(row, igdb);
      source = 'itad+igdb';
      igdbThemes = igdb.themes;
    }
  }

  const hidden = applyAdultFilter(
    row.name,
    itadGame.mature,
    deps.adultFilterEnabled,
    igdbThemes,
  );

  const stored = await upsertGame(deps.db, { ...row, hidden });
  if (!stored) return null; // matched a banned row (ROK-1843)

  return { gameId: stored.id, source, hidden: stored.hidden };
}

/** Check if a game slug is already banned. */
async function isBannedBySlug(
  db: PostgresJsDatabase<typeof schema>,
  slug: string,
): Promise<boolean> {
  const existing = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: { banned: true },
  });
  return existing?.banned === true;
}
