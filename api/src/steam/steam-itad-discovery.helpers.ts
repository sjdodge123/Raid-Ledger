/**
 * ITAD-primary game discovery helpers for Steam library sync (ROK-774).
 * When a Steam game isn't in the DB, looks it up via ITAD and creates a game row.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { ItadGame } from '../itad/itad.constants';
import type { IgdbApiGame } from '../igdb/igdb.constants';
import {
  enrichFromIgdb,
  type IgdbEnrichmentData,
} from './steam-igdb-enrichment.helpers';
import { checkAdultContent } from './steam-content-filter.helpers';

const logger = new Logger('SteamItadDiscovery');

/** Type for a games table insert row. */
type GameInsertRow = typeof schema.games.$inferInsert;

/** Dependencies injected into the discovery pipeline. */
export interface DiscoveryDeps {
  db: PostgresJsDatabase<typeof schema>;
  lookupBySteamAppId: (appId: number) => Promise<ItadGame | null>;
  queryIgdb?: (body: string) => Promise<IgdbApiGame[]>;
  adultFilterEnabled: boolean;
}

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
): GameInsertRow {
  return {
    name: itadGame.title,
    slug: itadGame.slug,
    steamAppId,
    itadGameId: itadGame.id,
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

/** Try to merge with an existing game by slug, or insert a new row. */
async function upsertGame(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<{ id: number }[]> {
  // Check if a game with this slug already exists (e.g. from IGDB import)
  const existing = await db.query.games.findFirst({
    where: eq(schema.games.slug, row.slug!),
    columns: { id: true, steamAppId: true },
  });

  if (existing) {
    // Update existing game with ITAD/Steam data instead of creating duplicate
    await db
      .update(schema.games)
      .set({
        steamAppId: row.steamAppId,
        itadGameId: row.itadGameId,
        coverUrl: row.coverUrl ?? undefined,
        hidden: row.hidden,
      })
      .where(eq(schema.games.id, existing.id));
    logger.debug(`Merged ITAD data into existing game ${existing.id}`);
    return [{ id: existing.id }];
  }

  return insertWithSlugRetry(db, row);
}

/** Insert a new game row, retrying with appended Steam app ID on slug collision. */
async function insertWithSlugRetry(
  db: PostgresJsDatabase<typeof schema>,
  row: GameInsertRow,
): Promise<{ id: number }[]> {
  try {
    return await db
      .insert(schema.games)
      .values(row)
      .returning({ id: schema.games.id });
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      const retryRow = {
        ...row,
        slug: `${row.slug}-${row.steamAppId}`,
      };
      return db
        .insert(schema.games)
        .values(retryRow)
        .returning({ id: schema.games.id });
    }
    throw err;
  }
}

/** Check if an error is a unique constraint violation (handles Drizzle wrapper). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && (err as { code: string }).code === '23505') return true;
  if ('cause' in err) return isUniqueViolation((err as { cause: unknown }).cause);
  return false;
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
 */
export async function discoverGameViaItad(
  steamAppId: number,
  deps: DiscoveryDeps,
): Promise<DiscoveryResult | null> {
  const itadGame = await deps.lookupBySteamAppId(steamAppId);
  if (!itadGame) return null;

  // Check if game is already banned by slug
  const banned = await isBannedBySlug(deps.db, itadGame.slug);
  if (banned) return null;

  let row = buildItadGameRow(itadGame, steamAppId);
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

  const insertRow: GameInsertRow = { ...row, hidden };
  const [result] = await upsertGame(deps.db, insertRow);

  return { gameId: result.id, source, hidden };
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
