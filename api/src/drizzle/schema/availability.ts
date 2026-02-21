import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { games } from './games';
import { events, tsrange } from './events';

/**
 * Availability windows for users (ROK-112).
 * Uses PostgreSQL tsrange for efficient overlap queries.
 *
 * Status states:
 * - available: User is free during this time
 * - committed: User has committed to an event
 * - blocked: User is unavailable (other obligations)
 * - freed: Previously committed slot that is now available
 */
export const availability = pgTable(
  'availability',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: integer('user_id')
      .references(() => users.id)
      .notNull(),
    /** Time range using PostgreSQL tsrange for efficient overlap queries */
    timeRange: tsrange('time_range').notNull(),
    /** Current status of this availability window */
    status: text('status', {
      enum: ['available', 'committed', 'blocked', 'freed'],
    })
      .default('available')
      .notNull(),
    /** Optional game-specific availability (null = all games). ROK-400: integer FK to games.id */
    gameId: integer('game_id').references(() => games.id),
    /** Reference to event if this is a committed slot */
    sourceEventId: integer('source_event_id').references(() => events.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // Performance index for user-scoped availability queries
    index('idx_availability_user_id').on(table.userId),
  ],
);

// Type inference helpers
export type Availability = typeof availability.$inferSelect;
export type NewAvailability = typeof availability.$inferInsert;
