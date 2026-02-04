import { pgTable, uuid, integer, text, timestamp } from 'drizzle-orm/pg-core';
import { users } from './users';
import { gameRegistry } from './game-registry';
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
export const availability = pgTable('availability', {
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
  /** Optional game-specific availability (null = all games) */
  gameId: uuid('game_id').references(() => gameRegistry.id),
  /** Reference to event if this is a committed slot */
  sourceEventId: integer('source_event_id').references(() => events.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Type inference helpers
export type Availability = typeof availability.$inferSelect;
export type NewAvailability = typeof availability.$inferInsert;
