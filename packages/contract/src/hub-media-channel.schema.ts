import { z } from 'zod';
import { SetGuildDiscordChannelSchema } from './guild-discord.schema.js';

/**
 * ROK-1941 D1/D2/D12 — a game server hub's Leader-set Discord "Pictures"
 * channel (`guilds/:id/media-channel`) and its 21-day backfill
 * (`guilds/:id/media-channel/backfill`). Strict: a renamed field fails the
 * parse instead of silently reading `undefined`.
 */

/** `PUT .../media-channel` body — the same snowflake rule as the mirror PUT. */
export const SetHubMediaChannelBodySchema = SetGuildDiscordChannelSchema;
export type SetHubMediaChannelBody = z.infer<typeof SetHubMediaChannelBodySchema>;

/** `GET`/`PUT .../media-channel` — the binding as the settings row reads it. */
export const HubMediaChannelStateSchema = z
    .object({
        channelId: z.string().nullable(),
        channelName: z.string().nullable(),
        /** OQ2: the mirror channel, offered while no pictures channel is set. */
        suggestedChannelId: z.string().nullable(),
        setAt: z.string().nullable(),
    })
    .strict();
export type HubMediaChannelState = z.infer<typeof HubMediaChannelStateSchema>;

const count = z.number().int().nonnegative();

/** D12 run counts. */
export const HubMediaBackfillSummarySchema = z
    .object({
        scanned: count,
        imagesStored: count,
        duplicates: count,
        deathsLinked: count,
        deathsInferred: count,
        unclassified: count,
        failed: count,
        oldestScannedAt: z.string().nullable(),
        finishedAt: z.string().nullable(),
    })
    .strict();
export type HubMediaBackfillSummary = z.infer<typeof HubMediaBackfillSummarySchema>;

export const HubMediaBackfillStateSchema = z.enum(['idle', 'running', 'done', 'failed']);
export type HubMediaBackfillState = z.infer<typeof HubMediaBackfillStateSchema>;

/** `GET .../backfill` (and the 202 of `POST`) — the hub's latest run. */
export const HubMediaBackfillStatusSchema = z
    .object({
        state: HubMediaBackfillStateSchema,
        startedAt: z.string().nullable(),
        finishedAt: z.string().nullable(),
        summary: HubMediaBackfillSummarySchema.nullable(),
    })
    .strict();
export type HubMediaBackfillStatus = z.infer<typeof HubMediaBackfillStatusSchema>;

/** The 409 body of `POST .../backfill` while a run is in flight. */
export const HubMediaBackfillConflictSchema = z.object({
    message: z.string(),
    job: HubMediaBackfillStatusSchema,
});
export type HubMediaBackfillConflict = z.infer<typeof HubMediaBackfillConflictSchema>;
