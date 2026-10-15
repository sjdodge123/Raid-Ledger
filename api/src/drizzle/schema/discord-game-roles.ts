import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  timestamp,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { games } from './games';
import { users } from './users';

/**
 * ROK-1767: a game linked to an auto-maintained Discord role. One row per
 * game. `bot_created` marks a role the bot made itself (it is never deleted
 * by the app — an admin deletes it in Discord).
 */
export const discordGameRoles = pgTable(
  'discord_game_roles',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .references(() => games.id, { onDelete: 'cascade' })
      .notNull()
      .unique('discord_game_roles_game_id_unique'),
    roleId: varchar('role_id', { length: 32 }).notNull(),
    botCreated: boolean('bot_created').default(false).notNull(),
    windowDays: integer('window_days').default(14).notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'discord_game_roles_window_days_range',
      sql`${table.windowDays} BETWEEN 1 AND 365`,
    ),
  ],
);

/**
 * ROK-1767: members the bot itself granted a game role to. Only these are
 * ever removed — a hand-assigned holder has no row here.
 */
export const discordGameRoleGrants = pgTable(
  'discord_game_role_grants',
  {
    gameRoleId: integer('game_role_id')
      .references(() => discordGameRoles.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    discordUserId: varchar('discord_user_id', { length: 32 }).notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: 'discord_game_role_grants_pk',
      columns: [table.gameRoleId, table.userId],
    }),
    // ROK-1157: FK backing index (the PK leads with game_role_id).
    index('idx_discord_game_role_grants_user_id').on(table.userId),
  ],
);

export type DiscordGameRoleSelect = typeof discordGameRoles.$inferSelect;
export type DiscordGameRoleGrantSelect =
  typeof discordGameRoleGrants.$inferSelect;
