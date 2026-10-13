import { z } from 'zod';
import { GameServerStateSchema } from './game-servers.schema.js';
import { PELICAN_ERROR_KINDS, isValidIanaTimezone } from './pelican.schema.js';

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

/* ── Admin servers table (ROK-1094) ─────────────────────────────────── */

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

/**
 * One row of `GET /admin/plugins/pelican/servers`. `.strict()` so a leaked
 * `panelUuid` / `identifier` fails the server's own response parse — no
 * uuid, identifier, node or address ever leaves the API.
 */
export const PelicanServerRowSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().max(200),
    state: GameServerStateSchema,
    isSuspended: z.boolean(),
    gameId: z.number().int().positive().nullable(),
    gameName: z.string().nullable(),
    showOnCalendar: z.boolean(),
    /** `null` = inherits the plugin's default timezone. */
    timezone: z.string().nullable(),
    lastSyncedAt: isoOrNull,
    statusCheckedAt: isoOrNull,
    /** The last complete listing did not include this server. */
    missing: z.boolean(),
  })
  .strict();
export type PelicanServerRowDto = z.infer<typeof PelicanServerRowSchema>;

export const PelicanServerListResponseSchema = z
  .object({ data: z.array(PelicanServerRowSchema) })
  .strict();
export type PelicanServerListResponse = z.infer<
  typeof PelicanServerListResponseSchema
>;

/** `PATCH /admin/plugins/pelican/servers/:id` — omitted = unchanged, `timezone: ''` = inherit. */
export const PelicanServerUpdateSchema = z
  .object({
    gameId: z.number().int().positive().nullable(),
    showOnCalendar: z.boolean(),
    timezone: z
      .string()
      .trim()
      .max(64)
      .refine((v) => v === '' || isValidIanaTimezone(v), {
        message: 'Unknown timezone',
      }),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: 'Nothing to update',
  });
export type PelicanServerUpdate = z.infer<typeof PelicanServerUpdateSchema>;
