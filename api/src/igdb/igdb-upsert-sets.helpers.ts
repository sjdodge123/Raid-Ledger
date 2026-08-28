/**
 * Column-mapping SET clauses for the `games` upsert paths.
 *
 * Split out of igdb-upsert.helpers.ts to keep that file inside the 300-line
 * limit (ROK-1438). Pure mapping — no queries, so nothing here needs the
 * find-then-insert name lock.
 */
import { sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { mapApiGameToDbRow } from './igdb.mappers';

/** Single-row upsert SET. COALESCE preserves existing twitch/steam ids when row is null. */
export function buildUpsertSet(row: ReturnType<typeof mapApiGameToDbRow>) {
  return {
    name: row.name,
    slug: row.slug,
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
    crossplay: row.crossplay,
    cachedAt: new Date(),
  };
}

/** Batch upsert SET (ROK-1024). Mirrors `buildUpsertSet` using `excluded.<column>` per row. */
export function buildBatchUpsertSet() {
  return {
    name: sql`excluded.name`,
    slug: sql`excluded.slug`,
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
    crossplay: sql`excluded.crossplay`,
    cachedAt: sql`now()`,
  };
}
