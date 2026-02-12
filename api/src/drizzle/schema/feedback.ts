import { pgTable, serial, integer, text, timestamp } from 'drizzle-orm/pg-core';
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
