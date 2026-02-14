import { pgTable, serial, text, boolean, timestamp } from 'drizzle-orm/pg-core';

/**
 * Cron job registry table (ROK-310).
 * Stores metadata + pause state for every registered cron job.
 * Jobs are auto-synced from SchedulerRegistry on app startup.
 */
export const cronJobs = pgTable('cron_jobs', {
  id: serial('id').primaryKey(),
  /** Unique job name, e.g. "core:igdb-sync" or "wow-common:character-auto-sync" */
  name: text('name').unique().notNull(),
  /** Where the job comes from: core (@Cron decorator), plugin (CronRegistrar), bullmq (queue) */
  source: text('source').notNull(),
  /** Plugin slug for plugin-sourced jobs, null for core jobs */
  pluginSlug: text('plugin_slug'),
  // Cron expression, e.g. "0 0 */6 * *"
  cronExpression: text('cron_expression').notNull(),
  /** Human-readable description */
  description: text('description'),
  /** When true, the job's handler is skipped and a "skipped" execution is logged */
  paused: boolean('paused').default(false).notNull(),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
