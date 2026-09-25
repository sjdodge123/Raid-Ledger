/**
 * Column-mapping SET clauses for the `games` upsert paths.
 *
 * Split out of igdb-upsert.helpers.ts to keep that file inside the 300-line
 * limit (ROK-1438). Pure mapping — no queries, so nothing here needs the
 * find-then-insert name lock.
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { SteamAppIdSource } from '../drizzle/schema';
import type { mapApiGameToDbRow } from './igdb.mappers';
import { keepSeedOwned } from '../games-lookup/seed-owned-games.helpers';

/**
 * SET expression for `games.steam_app_id_source` (ROK-1680). Writes `tag` only
 * when the incoming Steam id is non-null AND differs from the stored one;
 * otherwise it keeps the stored source. An agreeing id is corroboration, not a
 * new provenance. `newId` is SQL (a cast param or `excluded.steam_app_id`) so
 * the placeholder has a type Postgres can resolve.
 */
export function steamSourceOnChange(newId: SQL, tag: SteamAppIdSource): SQL {
  const stored = schema.games.steamAppId;
  return sql`CASE WHEN ${newId} IS NOT NULL AND ${newId} IS DISTINCT FROM ${stored} THEN ${tag}::varchar ELSE ${schema.games.steamAppIdSource} END`;
}

/**
 * Single-row upsert SET. COALESCE preserves existing twitch/steam ids when row
 * is null; seed-owned rows keep their curated name + slug (ROK-1643).
 */
export function buildUpsertSet(row: ReturnType<typeof mapApiGameToDbRow>) {
  return {
    name: keepSeedOwned(schema.games.name, row.name),
    slug: keepSeedOwned(schema.games.slug, row.slug),
    coverUrl: row.coverUrl,
    genres: row.genres,
    summary: row.summary,
    rating: row.rating,
    aggregatedRating: row.aggregatedRating,
    popularity: row.popularity,
    gameModes: row.gameModes,
    themes: row.themes,
    platforms: row.platforms,
    screenshots: row.screenshots,
    videos: row.videos,
    firstReleaseDate: row.firstReleaseDate,
    playerCount: row.playerCount,
    twitchGameId: row.twitchGameId ?? sql`${schema.games.twitchGameId}`,
    steamAppId: row.steamAppId ?? sql`${schema.games.steamAppId}`,
    steamAppIdSource:
      row.steamAppId == null
        ? sql`${schema.games.steamAppIdSource}`
        : steamSourceOnChange(sql`${row.steamAppId}::integer`, 'igdb'),
    crossplay: row.crossplay,
    cachedAt: new Date(),
  };
}

/** Batch upsert SET (ROK-1024). Mirrors `buildUpsertSet` using `excluded.<column>` per row. */
export function buildBatchUpsertSet() {
  return {
    name: keepSeedOwned(schema.games.name, sql`excluded.name`),
    slug: keepSeedOwned(schema.games.slug, sql`excluded.slug`),
    coverUrl: sql`excluded.cover_url`,
    genres: sql`excluded.genres`,
    summary: sql`excluded.summary`,
    rating: sql`excluded.rating`,
    aggregatedRating: sql`excluded.aggregated_rating`,
    popularity: sql`excluded.popularity`,
    gameModes: sql`excluded.game_modes`,
    themes: sql`excluded.themes`,
    platforms: sql`excluded.platforms`,
    screenshots: sql`excluded.screenshots`,
    videos: sql`excluded.videos`,
    firstReleaseDate: sql`excluded.first_release_date`,
    playerCount: sql`excluded.player_count`,
    twitchGameId: sql`COALESCE(excluded.twitch_game_id, ${schema.games.twitchGameId})`,
    steamAppId: sql`COALESCE(excluded.steam_app_id, ${schema.games.steamAppId})`,
    steamAppIdSource: steamSourceOnChange(sql`excluded.steam_app_id`, 'igdb'),
    crossplay: sql`excluded.crossplay`,
    cachedAt: sql`now()`,
  };
}
