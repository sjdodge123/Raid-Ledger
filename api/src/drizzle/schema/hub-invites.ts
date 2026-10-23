import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { guilds } from './guilds';
import { users } from './users';

/**
 * ROK-1893 P1 (M1): share links into a game community hub
 * (`guilds.kind = 'game_community'`). Any live member may make one (spec §8a);
 * the maker, hub Leaders/Officers and staff revoke (§8d). A link is LIVE when
 * `revoked_at IS NULL`, `expires_at` is null or in the future, and
 * `max_uses` is null or above `use_count`.
 */
export const hubInvites = pgTable(
  'hub_invites',
  {
    id: serial('id').primaryKey(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    /** URL-safe share token behind `/h/:token`. */
    token: varchar('token', { length: 64 }).notNull().unique(),
    /** The maker; SET NULL so the link survives its maker's deletion. */
    createdBy: integer('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Null = never expires. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Null = unlimited uses. */
    maxUses: integer('max_uses'),
    /** Counts redemptions that created a new live membership. */
    useCount: integer('use_count').default(0).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'hub_invites_max_uses_check',
      sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`,
    ),
    // ROK-1157: FK backing indexes.
    index('idx_hub_invites_guild_id').on(table.guildId),
    index('idx_hub_invites_created_by').on(table.createdBy),
    /** Per-member live-link cap (5) and the per-hub list of open links. */
    index('idx_hub_invites_live_by_maker')
      .on(table.guildId, table.createdBy)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export type HubInviteInsert = typeof hubInvites.$inferInsert;
export type HubInviteSelect = typeof hubInvites.$inferSelect;
