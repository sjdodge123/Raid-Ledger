import { z } from 'zod';
import { PELICAN_ERROR_KINDS } from './pelican.schema.js';

/**
 * Pelican server mirror — admin "Sync now" (ROK-1772).
 * `POST /admin/plugins/pelican/sync` is always HTTP 200; the outcome is data.
 */

/** Every outcome of one server sync, including a run already in flight. */
export const PELICAN_SYNC_CODES = [
  'ok',
  'not_configured',
  'in_progress',
  'partial_listing',
  'internal_error',
  ...PELICAN_ERROR_KINDS,
] as const;
export const PelicanSyncCodeSchema = z.enum(PELICAN_SYNC_CODES);
export type PelicanSyncCode = z.infer<typeof PelicanSyncCodeSchema>;

const count = z.number().int().nonnegative();

/**
 * What the status poll after a successful sync did (ruling Q5).
 * `alreadyRunning` is set when the poll was skipped because another poll
 * (usually the cron tick) was in flight; the counts are then all zero.
 */
export const PelicanStatusPollSummarySchema = z
  .object({
    polled: count,
    failed: count,
    skipped: count,
    alreadyRunning: z.literal(true).optional(),
  })
  .strict();
export type PelicanStatusPollSummary = z.infer<
  typeof PelicanStatusPollSummarySchema
>;

export const PelicanSyncResultSchema = z
  .object({
    code: PelicanSyncCodeSchema,
    message: z.string(),
    upserted: count,
    markedMissing: count,
    restored: count,
    /** `null` when the sync did not succeed, so no poll ran. */
    status: PelicanStatusPollSummarySchema.nullable(),
  })
  .strict();
export type PelicanSyncResult = z.infer<typeof PelicanSyncResultSchema>;
