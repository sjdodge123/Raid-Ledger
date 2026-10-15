import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from 'drizzle-orm/pg-core';
import type { FeedbackClientContext } from '@raid-ledger/contract';
import { users } from './users';

/**
 * User feedback table — stores bug reports, feature requests,
 * improvement suggestions, and general feedback.
 * ROK-186: User Feedback Widget.
 */
export const feedback = pgTable('feedback', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  pageUrl: text('page_url'),
  githubIssueUrl: text('github_issue_url'),
  clientLogs: text('client_logs'),
  /** ROK-1313: `feedback/<id>.png|jpg`, relative to the uploads root. */
  screenshotPath: text('screenshot_path'),
  /** ROK-1313: viewport, user agent and app version at submit time. */
  clientContext: jsonb('client_context').$type<FeedbackClientContext>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
