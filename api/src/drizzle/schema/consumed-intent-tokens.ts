import {
  pgTable,
  serial,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Tracks consumed intent tokens for single-use enforcement (ROK-979).
 * Uses INSERT ... ON CONFLICT DO NOTHING on the unique tokenHash column.
 * A cleanup cron purges rows older than 15 minutes (the JWT expiry window).
 */
export const consumedIntentTokens = pgTable(
  'consumed_intent_tokens',
  {
    id: serial('id').primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    consumedAt: timestamp('consumed_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_consumed_intent_tokens_consumed_at').on(table.consumedAt),
  ],
);

export type ConsumedIntentToken = typeof consumedIntentTokens.$inferSelect;
export type NewConsumedIntentToken = typeof consumedIntentTokens.$inferInsert;
