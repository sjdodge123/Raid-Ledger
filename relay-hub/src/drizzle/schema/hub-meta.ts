import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Hub-wide key/value facts. `catalog_epoch` is inserted by migration 0001
 * (self-contained: no app code seeds it).
 */
export const hubMeta = pgTable('hub_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
