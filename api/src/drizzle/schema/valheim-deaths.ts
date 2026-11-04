import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { hubMedia } from './hub-media';
import { serverFk, tsz } from './valheim-columns';

/**
 * ROK-1930: one row per player death on a Valheim server. `source = 'log'`
 * rows come from the console's `0:0` ZDOID lines (deduped on server +
 * character name + the line's own zone-less timestamp, because replays
 * resend old lines); `'mod'` rows are deaths the mod reported (ROK-1931,
 * with x/z and the character key, deduped on `reported_at`).
 * ROK-1941: `'discord'` rows are inferred from a death screenshot post with
 * no matching log/mod death; `hub_media_id` links a death to its picture.
 */
export const valheimPlayerDeaths = pgTable(
  'valheim_player_deaths',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    pelicanServerId: serverFk(),
    /** From the log line — free game text, never logged. */
    characterName: text('character_name').notNull(),
    /** SteamID64 when the tracker could attribute the death, else null. */
    steamId: text('steam_id'),
    source: text('source').notNull().default('log'),
    /** The parser's zone-less `yyyy-MM-ddTHH:mm:ss`, verbatim (the dedupe key). */
    loggedAt: text('logged_at'),
    occurredAt: tsz('occurred_at').notNull(),
    x: doublePrecision('x'),
    z: doublePrecision('z'),
    /** ROK-1931 (D4): the contract's character key (int64 string) of a reported death. */
    playerId: text('player_id'),
    /** ROK-1931: the world the reported death happened on (the character's world here). */
    worldUid: text('world_uid'),
    /** ROK-1931: the mod's `at`, verbatim — never rewritten (the dedupe key). */
    reportedAt: tsz('reported_at'),
    /** ROK-1941 (D8): the death post's first picture; one death ↔ one post. */
    hubMediaId: bigint('hub_media_id', { mode: 'number' }).references(
      () => hubMedia.id,
      { onDelete: 'set null' },
    ),
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Leading pelican_server_id also backs the FK.
    uniqueIndex('valheim_player_deaths_log_uq')
      .on(t.pelicanServerId, t.characterName, t.loggedAt)
      .where(sql`${t.source} = 'log'`),
    // ROK-1931 (D4): a reported death is stored once per character + `at`.
    uniqueIndex('valheim_player_deaths_reported_uq')
      .on(t.pelicanServerId, t.steamId, t.playerId, t.reportedAt)
      .where(sql`${t.reportedAt} IS NOT NULL`),
    index('valheim_player_deaths_server_steam_idx').on(
      t.pelicanServerId,
      t.steamId,
    ),
    // ROK-1941 (D8): one death per picture. Deliberately NOT partial —
    // NULLs never collide in a unique index, and a non-partial index also
    // backs the hub_media FK's ON DELETE SET NULL (fk-index-coverage.spec).
    uniqueIndex('valheim_player_deaths_media_uq').on(t.hubMediaId),
    // ROK-1941: both death↔post correlation lookups (case-insensitive name).
    index('valheim_player_deaths_server_name_time_idx').on(
      t.pelicanServerId,
      sql`lower(${t.characterName})`,
      t.occurredAt,
    ),
    check(
      'valheim_player_deaths_source_check',
      sql`${t.source} IN ('log', 'mod', 'discord')`,
    ),
    check(
      'valheim_player_deaths_log_ts_check',
      sql`${t.source} <> 'log' OR ${t.loggedAt} IS NOT NULL`,
    ),
    check(
      'valheim_player_deaths_mod_shape_check',
      sql`${t.source} <> 'mod' OR (${t.reportedAt} IS NOT NULL AND ${t.x} IS NOT NULL AND ${t.z} IS NOT NULL AND ${t.playerId} IS NOT NULL AND ${t.worldUid} IS NOT NULL)`,
    ),
  ],
);

export type ValheimPlayerDeathRow = typeof valheimPlayerDeaths.$inferSelect;
