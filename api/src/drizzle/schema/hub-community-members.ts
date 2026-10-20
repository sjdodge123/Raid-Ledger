import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1870 D3: membership of a game community hub
 * (`guilds.kind = 'game_community'`) — core-owned, unlike the Pelican
 * `hub_server_members`. One row per (hub, user) that survives leave, remove
 * and ban, so history and the ban persist. A row is LIVE when
 * `left_at IS NULL AND banned_at IS NULL`.
 */
export const hubCommunityMembers = pgTable(
  'hub_community_members',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    /** D4 ladder role while live: leader | officer | member. */
    role: varchar('role', {
      length: 8,
      enum: ['leader', 'officer', 'member'],
    }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Left or removed (D7); null while live. */
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** The officer/leader/staff who removed them; null for a self-leave. */
    removedBy: integer('removed_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** D7 ban — Join is refused until unbanned. */
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    bannedBy: integer('banned_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    banReason: varchar('ban_reason', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'hub_community_members_role_check',
      sql`${table.role} IN ('leader', 'officer', 'member')`,
    ),
    uniqueIndex('idx_hub_community_members_guild_user').on(
      table.guildId,
      table.userId,
    ),
    /** D5: exactly one live Leader per hub. */
    uniqueIndex('idx_hub_community_one_leader')
      .on(table.guildId)
      .where(
        sql`${table.role} = 'leader' AND ${table.leftAt} IS NULL AND ${table.bannedAt} IS NULL`,
      ),
    // ROK-1157: FK backing indexes (guild_id leads the unique).
    index('idx_hub_community_members_user_id').on(table.userId),
    index('idx_hub_community_members_removed_by').on(table.removedBy),
    index('idx_hub_community_members_banned_by').on(table.bannedBy),
    /** Live-member counts and lists. */
    index('idx_hub_community_members_live')
      .on(table.guildId)
      .where(sql`${table.leftAt} IS NULL AND ${table.bannedAt} IS NULL`),
  ],
);

export type HubCommunityMemberInsert = typeof hubCommunityMembers.$inferInsert;
export type HubCommunityMemberSelect = typeof hubCommunityMembers.$inferSelect;
