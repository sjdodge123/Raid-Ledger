import { eq, and, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { IgdbGameDto, GameDetailDto } from '@raid-ledger/contract';
import { mapDbRowToDetail, mapCooptimusExtras } from './igdb.mappers';
import { stripCooptimusProse } from './cooptimus-prose.helpers';
import { discoverGameViaItad } from '../steam/steam-itad-discovery.helpers';
import type { ItadGame } from '../itad/itad.constants';

/**
 * Look up a game by ID and return a lightweight DTO.
 * @param db - Database connection
 * @param id - Game ID
 * @returns IgdbGameDto or null if not found
 */
export async function lookupGameById(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
): Promise<IgdbGameDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  const row = r[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    igdbId: row.igdbId,
    name: row.name,
    slug: row.slug,
    coverUrl: row.coverUrl,
  };
}

/**
 * Look up a game by ID and return a full detail DTO.
 * @param db - Database connection
 * @param id - Game ID
 * @param cooptimusProseEnabled - Operator opt-in for Co-Optimus editorial prose
 *   (ROK-1398). Required, not defaulted: every caller must decide, and the only
 *   correct source is `SettingsService.getCooptimusProseEnabled()`.
 * @returns GameDetailDto or null if not found
 */
export async function lookupGameDetailById(
  db: PostgresJsDatabase<typeof schema>,
  id: number,
  cooptimusProseEnabled: boolean,
): Promise<GameDetailDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(eq(schema.games.id, id))
    .limit(1);
  const row = r[0];
  if (row === undefined) return null;
  // Detail endpoint carries the Co-Optimus editorial extras; list builders
  // use bare mapDbRowToDetail and never ship the blob (ROK-1397). The prose
  // inside that blob is stripped unless the operator opted in (ROK-1398).
  const detail = { ...mapDbRowToDetail(row), ...mapCooptimusExtras(row) };
  return stripCooptimusProse(detail, cooptimusProseEnabled);
}

/**
 * Look up a game by Steam App ID (ROK-945).
 * Excludes hidden and banned games.
 * @param db - Database connection
 * @param steamAppId - Steam store application ID
 * @returns IgdbGameDto or null if not found
 */
export async function lookupGameBySteamAppId(
  db: PostgresJsDatabase<typeof schema>,
  steamAppId: number,
): Promise<IgdbGameDto | null> {
  const r = await db
    .select()
    .from(schema.games)
    .where(
      and(
        eq(schema.games.steamAppId, steamAppId),
        eq(schema.games.hidden, false),
        eq(schema.games.banned, false),
      ),
    )
    .limit(1);
  const row = r[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    igdbId: row.igdbId,
    name: row.name,
    slug: row.slug,
    coverUrl: row.coverUrl,
  };
}

/** Dependencies for ITAD-based Steam lookup + discovery (ROK-945). */
export interface SteamLookupDeps {
  db: PostgresJsDatabase<typeof schema>;
  lookupBySteamAppId: (appId: number) => Promise<ItadGame | null>;
  adultFilterEnabled: boolean;
}

/**
 * True when a row with this Steam App ID exists but an admin hid or banned it
 * (ROK-1843). Deliberately unfiltered: the visible-only fast path misses a
 * moderated row, and that miss used to trigger a rediscovery that un-hid it.
 */
async function isSteamAppIdModerated(
  db: PostgresJsDatabase<typeof schema>,
  steamAppId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(
      and(
        eq(schema.games.steamAppId, steamAppId),
        or(eq(schema.games.hidden, true), eq(schema.games.banned, true)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Resolve a Steam App ID to a game DTO (ROK-945 rework).
 * 1. Local DB lookup (fast path).
 * 2. A hidden/banned row with this id → null (404); never rediscovered.
 * 3. If missing, discover via ITAD and insert into DB. A discovery that lands
 *    on (or creates) a hidden row → null, so the route never serves it.
 * Returns { game, newGameId } — newGameId is set when ITAD created a row.
 */
export async function resolveGameBySteamAppId(
  steamAppId: number,
  deps: SteamLookupDeps,
): Promise<{ game: IgdbGameDto; newGameId: number | null } | null> {
  const existing = await lookupGameBySteamAppId(deps.db, steamAppId);
  if (existing) return { game: existing, newGameId: null };
  if (await isSteamAppIdModerated(deps.db, steamAppId)) return null;

  const result = await discoverGameViaItad(
    steamAppId,
    {
      ...deps,
      queryIgdb: undefined, // Skip sync IGDB — enrichment runs async
    },
    'itad',
  );
  if (!result || result.hidden) return null;

  const created = await lookupGameById(deps.db, result.gameId);
  if (!created) return null;
  return { game: created, newGameId: result.gameId };
}
