import {
  pgTable,
  integer,
  timestamp,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { guilds } from './guilds';

/**
 * Hub Notification Mutes (ROK-1832) — a user's per-group "bell off" list.
 *
 * A row silences the group's leader-post and event-tagged notices (in-app and
 * Discord DM) for that (user, guild). Independent of the per-game mute
 * (ROK-1797, `game_notification_mutes`) and of hub membership itself.
 * Readers AND `notHubMutedSql` (notifications/hub-notification-mute.helpers).
 */
export const hubNotificationMutes = pgTable(
  'hub_notification_mutes',
  {
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    guildId: integer('guild_id')
      .references(() => guilds.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.guildId] }),
    index('idx_hub_notification_mutes_guild_id').on(table.guildId),
  ],
);
