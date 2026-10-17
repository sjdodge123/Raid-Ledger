import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { cronJobs } from './cron-jobs';

/**
 * Cron job execution history table (ROK-310).
 * Stores the last N executions per job for monitoring.
 * Pruned to 50 rows per job by CronJobService.
 */
export const cronJobExecutions = pgTable(
  'cron_job_executions',
  {
    id: serial('id').primaryKey(),
    cronJobId: integer('cron_job_id')
      .references(() => cronJobs.id, { onDelete: 'cascade' })
      .notNull(),
    /** completed | failed | skipped */
    status: text('status').notNull(),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    finishedAt: timestamp('finished_at'),
    /** Execution duration in milliseconds */
    durationMs: integer('duration_ms'),
    /** Error message if status is "failed" */
    error: text('error'),
  },
  (table) => ({
    /** Index for fast history lookups ordered by most recent first */
    cronJobStartedIdx: index('cron_job_executions_job_started_idx').on(
      table.cronJobId,
      table.startedAt,
    ),
  }),
);
