import {
  pgTable,
  integer,
  bigint,
  smallint,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { guildMembers } from './guild-members';

/**
 * ROK-2133: Battle.net Armory snapshot for a WoW: Forever guild-roster
 * member — plugin-owned (only `plugins/wow-common` reads or writes it).
 *
 * One row per member the roster Armory pass has attempted. The data columns
 * mirror the `characters` Armory columns (same JSON shapes) so a claim copies
 * them column-to-column. A snapshot is stored only when the fetched profile
 * id equals `blizzard_character_id`. Deleting the member cascades.
 */
export const guildMemberArmory = pgTable(
  'guild_member_armory',
  {
    guildMemberId: integer('guild_member_id')
      .primaryKey()
      .references(() => guildMembers.id, { onDelete: 'cascade' }),
    /** Blizzard id the last stored snapshot was verified against. */
    blizzardCharacterId: bigint('blizzard_character_id', { mode: 'number' }),
    level: integer('level'),
    class: varchar('class', { length: 50 }),
    race: varchar('race', { length: 50 }),
    spec: varchar('spec', { length: 50 }),
    role: varchar('role', { length: 20 }),
    itemLevel: integer('item_level'),
    avatarUrl: text('avatar_url'),
    /** Same shape as `characters.equipment`. */
    equipment: jsonb('equipment'),
    /** Same shape as `characters.talents`. */
    talents: jsonb('talents'),
    /** Same shape as `characters.armory_professions`. */
    armoryProfessions: jsonb('armory_professions'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** Last successful fetch; null = never synced. */
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    /** Consecutive failed attempts; drives the backoff. */
    failures: smallint('failures').notNull().default(0),
    /** Earliest time the next attempt may call Blizzard. */
    retryAt: timestamp('retry_at', { withTimezone: true }),
    /** `MemberArmoryErrorKind` of the last failure. */
    lastError: varchar('last_error', { length: 32 }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_guild_member_armory_retry_at').on(table.retryAt),
    index('idx_guild_member_armory_blizzard_id').on(table.blizzardCharacterId),
  ],
);

export type GuildMemberArmoryInsert = typeof guildMemberArmory.$inferInsert;
export type GuildMemberArmorySelect = typeof guildMemberArmory.$inferSelect;
