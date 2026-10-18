import { z } from 'zod';
import { GameServerStateSchema } from './game-servers.schema.js';
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

/* ── Admin servers table (ROK-1094) ─────────────────────────────────── */

const isoOrNull = z.iso.datetime({ offset: true }).nullable();

/** A plugin named in an admin hint: its id and display name (ROK-1819). */
export const PelicanPresencePluginRefSchema = z
  .object({ pluginId: z.string().min(1), pluginName: z.string().min(1) })
  .strict();
export type PelicanPresencePluginRef = z.infer<
  typeof PelicanPresencePluginRefSchema
>;

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
    /** "Detect Quick Play from server logs" is on (ROK-1800). */
    presenceTracking: z.boolean(),
    /** The mapped game has an active `game-log-parser` adapter — the switch can be turned on. */
    presenceSupported: z.boolean(),
    /**
     * The game has a log parser, but the plugin that owns it is inactive
     * (ROK-1819) — the admin activates that plugin to enable the switch.
     * Absent when the parser is live or the game has none.
     */
    presencePluginInactive: PelicanPresencePluginRefSchema.optional(),
    lastSyncedAt: isoOrNull,
    statusCheckedAt: isoOrNull,
    /** The last complete listing did not include this server. */
    missing: z.boolean(),
    /**
     * ROK-1831 — the server's community hub (`guilds.kind = 'game_server'`);
     * null when "Make a community hub" was never switched on. `hidden` = the
     * switch is off again (`guilds.hidden_at` set, data kept). Optional so a
     * row built before the hub layer still parses (additive).
     */
    communityHub: z
      .object({ guildId: z.number().int().positive(), hidden: z.boolean() })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();
export type PelicanServerRowDto = z.infer<typeof PelicanServerRowSchema>;

export const PelicanServerListResponseSchema = z
  .object({ data: z.array(PelicanServerRowSchema) })
  .strict();
export type PelicanServerListResponse = z.infer<
  typeof PelicanServerListResponseSchema
>;

/**
 * `PATCH /admin/plugins/pelican/servers/:id` — omitted = unchanged. Pelican
 * schedules are always UTC (ROK-1795), so there is no timezone field.
 */
export const PelicanServerUpdateSchema = z
  .object({
    gameId: z.number().int().positive().nullable(),
    showOnCalendar: z.boolean(),
    presenceTracking: z.boolean(),
    /** ROK-1831 — on creates or un-hides the hub; off hides it. */
    communityHub: z.boolean(),
  })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: 'Nothing to update',
  });
export type PelicanServerUpdate = z.infer<typeof PelicanServerUpdateSchema>;
