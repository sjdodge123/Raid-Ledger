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
import { guildMembers } from './guild-members';
import { users } from './users';

/**
 * ROK-1785 (S1 of ROK-1781): delegated guild-page editors — plugin-owned.
 *
 * The GM (rank 0) grants edit rights to a whole rank (`kind = 'rank'`) or to
 * one guild member row (`kind = 'member'`). A member grant follows the
 * in-game character and dies with its `guild_members` row. Rights are read
 * live by `GuildAccessService`; nothing here is cached per user.
 */
export const guildEditors = pgTable(
  'guild_editors',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    /** rank | member */
    kind: varchar('kind', { length: 10 }).notNull(),
    rankIndex: integer('rank_index'),
    guildMemberId: integer('guild_member_id').references(
      () => guildMembers.id,
      { onDelete: 'cascade' },
    ),
    grantedBy: integer('granted_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /** Exactly one target per kind. */
    check(
      'guild_editors_kind_target',
      sql`(${table.kind} = 'rank' AND ${table.rankIndex} IS NOT NULL AND ${table.guildMemberId} IS NULL) OR (${table.kind} = 'member' AND ${table.guildMemberId} IS NOT NULL AND ${table.rankIndex} IS NULL)`,
    ),
    uniqueIndex('idx_guild_editors_guild_rank')
      .on(table.guildId, table.rankIndex)
      .where(sql`${table.rankIndex} IS NOT NULL`),
    uniqueIndex('idx_guild_editors_guild_member')
      .on(table.guildId, table.guildMemberId)
      .where(sql`${table.guildMemberId} IS NOT NULL`),
    // ROK-1157: FK backing indexes — the partial uniques above do not count.
    index('idx_guild_editors_guild_id').on(table.guildId),
    index('idx_guild_editors_guild_member_id').on(table.guildMemberId),
    index('idx_guild_editors_granted_by').on(table.grantedBy),
  ],
);

export type GuildEditorInsert = typeof guildEditors.$inferInsert;
export type GuildEditorSelect = typeof guildEditors.$inferSelect;
