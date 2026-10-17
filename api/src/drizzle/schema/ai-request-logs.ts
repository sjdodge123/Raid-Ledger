import {
  pgTable,
  serial,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Tracks every LLM request for usage analytics and cost monitoring.
 */
export const aiRequestLogs = pgTable(
  'ai_request_logs',
  {
    id: serial('id').primaryKey(),
    feature: varchar('feature', { length: 50 }).notNull(),
    userId: integer('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    provider: varchar('provider', { length: 50 }).notNull(),
    model: varchar('model', { length: 100 }).notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    success: boolean('success').notNull(),
    errorMessage: varchar('error_message', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_ai_request_logs_created_at').on(table.createdAt),
    index('idx_ai_request_logs_feature_created_at').on(
      table.feature,
      table.createdAt,
    ),
    // ROK-1148: serves getLastSuccessfulChatAt — WHERE provider = ? AND
    // success = true, aggregating max(created_at). Column order matters: the
    // two equality predicates lead so the trailing created_at stays ordered
    // within the matched range, letting Postgres take the max from an
    // index-only backward scan instead of falling back to the created_at
    // index or a seq scan.
    index('idx_ai_request_logs_provider_success_created_at').on(
      table.provider,
      table.success,
      table.createdAt,
    ),
  ],
);
