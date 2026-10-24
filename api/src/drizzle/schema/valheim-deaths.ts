import {
  bigserial,
  check,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { serverFk, tsz } from './valheim-columns';

/**
 * ROK-1930: one row per player death on a Valheim server. `source = 'log'`
 * rows come from the console's `0:0` ZDOID lines (deduped on server +
 * character name + the line's own zone-less timestamp, because replays
 * resend old lines); `'mod'` is reserved for ROK-1931 (with x/z).
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
    createdAt: tsz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Leading pelican_server_id also backs the FK.
    uniqueIndex('valheim_player_deaths_log_uq')
      .on(t.pelicanServerId, t.characterName, t.loggedAt)
      .where(sql`${t.source} = 'log'`),
    index('valheim_player_deaths_server_steam_idx').on(
      t.pelicanServerId,
      t.steamId,
    ),
    check(
      'valheim_player_deaths_source_check',
      sql`${t.source} IN ('log', 'mod')`,
    ),
    check(
      'valheim_player_deaths_log_ts_check',
      sql`${t.source} <> 'log' OR ${t.loggedAt} IS NOT NULL`,
    ),
  ],
);

export type ValheimPlayerDeathRow = typeof valheimPlayerDeaths.$inferSelect;
