import { z } from 'zod';

/**
 * Demo Data schemas (ROK-193)
 * Shared types for the admin demo data install/delete feature.
 */

export const DemoDataCountsSchema = z.object({
  users: z.number(),
  events: z.number(),
  characters: z.number(),
  signups: z.number(),
  availability: z.number(),
  gameTimeSlots: z.number(),
  notifications: z.number(),
});

export type DemoDataCountsDto = z.infer<typeof DemoDataCountsSchema>;

export const DemoDataStatusSchema = DemoDataCountsSchema.extend({
  demoMode: z.boolean(),
});

export type DemoDataStatusDto = z.infer<typeof DemoDataStatusSchema>;

export const DemoDataResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  counts: DemoDataCountsSchema,
});

export type DemoDataResultDto = z.infer<typeof DemoDataResultSchema>;

/**
 * Cron Job Manager schemas (ROK-310)
 * Shared types for admin cron job monitoring and management.
 */

export const CronJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  source: z.enum(['core', 'plugin', 'bullmq']),
  pluginSlug: z.string().nullable(),
  cronExpression: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  paused: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Count of 'completed' executions in recent history. */
  completedCount: z.number().optional(),
  /** Count of 'no-op' executions in recent history. */
  noOpCount: z.number().optional(),
  /** True when the job issues LLM calls (surfaces an AI badge + filter in admin UI). */
  usesAi: z.boolean().optional(),
});

export type CronJobDto = z.infer<typeof CronJobSchema>;

export const CronJobExecutionSchema = z.object({
  id: z.number(),
  cronJobId: z.number(),
  status: z.enum(['completed', 'failed', 'skipped', 'no-op']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type CronJobExecutionDto = z.infer<typeof CronJobExecutionSchema>;
