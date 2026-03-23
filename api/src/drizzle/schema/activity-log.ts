import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Generic activity log for entity timelines (ROK-930).
 *
 * Supports multiple entity types (lineup, event) with a shared table.
 * Each row records a single action with optional actor and metadata.
 */
export const activityLog = pgTable(
  'activity_log',
  {
    id: serial('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: integer('entity_id').notNull(),
    action: text('action').notNull(),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_activity_log_entity').on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
  ],
);
