import {
  pgTable,
  serial,
  varchar,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Tracks notification dedup keys to prevent duplicate sends (ROK-978).
 * Survives Redis restarts by persisting dedup state in the database.
 * Uses a unique constraint on dedup_key + ON CONFLICT DO NOTHING
 * for atomic idempotent inserts.
 */
export const notificationDedup = pgTable(
  'notification_dedup',
  {
    id: serial('id').primaryKey(),
    dedupKey: varchar('dedup_key', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('uq_notification_dedup_key').on(table.dedupKey),
    index('idx_notification_dedup_expires_at').on(table.expiresAt),
  ],
);

export type NotificationDedupRow = typeof notificationDedup.$inferSelect;
export type NewNotificationDedupRow = typeof notificationDedup.$inferInsert;
