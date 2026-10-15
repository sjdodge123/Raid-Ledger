import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { events } from './events';
import { users } from './users';

/**
 * Ad-Hoc Participants — tracks Discord voice channel members who participated
 * in an ad-hoc event session (ROK-293).
 *
 * Users with linked RL accounts have userId populated.
 * Unlinked Discord users are tracked as anonymous participants via discordUserId.
 *
 * ROK-1800: a game-server (Steam) player has no Discord id — `steamId` carries
 * the identity and `discordUsername` holds the display name (character name,
 * else SteamID64). A row needs at least one of the two ids (CHECK below); a
 * linked RL user present in voice AND on the server shares ONE row.
 */
export const adHocParticipants = pgTable(
  'ad_hoc_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: integer('event_id')
      .references(() => events.id, { onDelete: 'cascade' })
      .notNull(),
    /** RL user ID — nullable for anonymous/unlinked Discord users */
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Null for a Steam-only (game-server) participant (ROK-1800). */
    discordUserId: varchar('discord_user_id', { length: 255 }),
    /** SteamID64 of a game-server participant (ROK-1800). */
    steamId: varchar('steam_id', { length: 32 }),
    /** Where the row was first seen: 'discord' (voice) or 'steam' (server). */
    source: varchar('source', { length: 16 }).notNull().default('discord'),
    /** Display name — Discord username, or character name / SteamID64. */
    discordUsername: varchar('discord_username', { length: 255 }).notNull(),
    discordAvatarHash: varchar('discord_avatar_hash', { length: 255 }),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
    /** Total seconds spent in the voice channel across all sessions */
    totalDurationSeconds: integer('total_duration_seconds'),
    /** Number of join/leave cycles in this event */
    sessionCount: integer('session_count').default(1).notNull(),
  },
  (table) => ({
    eventDiscordUserUnique: uniqueIndex(
      'ad_hoc_participants_event_discord_user_unique',
    )
      .on(table.eventId, table.discordUserId)
      .where(sql`${table.discordUserId} IS NOT NULL`),
    eventSteamUnique: uniqueIndex('ad_hoc_participants_event_steam_unique')
      .on(table.eventId, table.steamId)
      .where(sql`${table.steamId} IS NOT NULL`),
    identityCheck: check(
      'ad_hoc_participants_identity_check',
      sql`${table.discordUserId} IS NOT NULL OR ${table.steamId} IS NOT NULL`,
    ),
    eventIdx: index('idx_ad_hoc_participants_event').on(table.eventId),
    userIdx: index('idx_ad_hoc_participants_user').on(table.userId),
  }),
);
