import { pgTable, integer, char, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROK-1599 (epic ROK-669 §4.3): one private ICS subscribe link per user.
 *
 * The token is a bearer secret. `token_hash` (sha256 hex) is what the public
 * `/api/cal/u/<token>.ics` route looks up; `token_encrypted` keeps a
 * reversible copy so the owner can be shown their link again (rotated by
 * `scripts/reencrypt-settings.ts` on a JWT_SECRET change). Never log either.
 * Personal — wiped with the user (users-delete.helpers.ts WIPE_BY_COLUMN).
 * No `include_tentative`: tentative sign-ups are always in the feed
 * (operator ruling OPERATOR-2).
 */
export const calendarFeeds = pgTable('calendar_feeds', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
  tokenEncrypted: text('token_encrypted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
});
