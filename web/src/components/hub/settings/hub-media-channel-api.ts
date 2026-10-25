/**
 * ROK-1941 D2 — the hub's Leader-set Discord "Pictures" channel and its
 * 21-day backfill (`guilds/:id/media-channel[/backfill]`). Every response is
 * parsed. The shapes are local until the contract gains
 * `hub-media-channel.schema.ts` (spec "Contract"); they mirror the API's
 * `HubMediaChannelState` and `HubMediaBackfillStatus` field for field.
 */
import { z } from 'zod';
import { fetchApi } from '../../../lib/api-client';
import { errorBodyOf } from '../../../lib/api/api-error';

export const HubMediaChannelStateSchema = z.object({
    channelId: z.string().nullable(),
    channelName: z.string().nullable(),
    /** OQ2: the mirror channel, offered while no pictures channel is set. */
    suggestedChannelId: z.string().nullable(),
    setAt: z.string().nullable(),
});
export type HubMediaChannelState = z.infer<typeof HubMediaChannelStateSchema>;

export const HubMediaBackfillSummarySchema = z.object({
    scanned: z.number().int(), imagesStored: z.number().int(), duplicates: z.number().int(),
    deathsLinked: z.number().int(), deathsInferred: z.number().int(), unclassified: z.number().int(),
    failed: z.number().int(), oldestScannedAt: z.string().nullable(), finishedAt: z.string().nullable(),
});
export type HubMediaBackfillSummary = z.infer<typeof HubMediaBackfillSummarySchema>;

export const HubMediaBackfillStatusSchema = z.object({
    state: z.enum(['idle', 'running', 'done', 'failed']),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    summary: HubMediaBackfillSummarySchema.nullable(),
});
export type HubMediaBackfillStatus = z.infer<typeof HubMediaBackfillStatusSchema>;

const base = (guildId: number): string => `/guilds/${guildId}/media-channel`;

/** The current binding plus the mirror channel as a suggestion. */
export function fetchHubMediaChannel(guildId: number): Promise<HubMediaChannelState> {
    return fetchApi(base(guildId), {}, HubMediaChannelStateSchema);
}

/** Bind a channel the bot can read; the server answers with the new state. */
export function putHubMediaChannel(guildId: number, channelId: string): Promise<HubMediaChannelState> {
    return fetchApi(base(guildId), { method: 'PUT', body: JSON.stringify({ channelId }) }, HubMediaChannelStateSchema);
}

export function deleteHubMediaChannel(guildId: number): Promise<void> {
    return fetchApi<void>(base(guildId), { method: 'DELETE' });
}

/** The hub's latest backfill run (`idle` when none has run since the API started). */
export function fetchHubMediaBackfill(guildId: number): Promise<HubMediaBackfillStatus> {
    return fetchApi(`${base(guildId)}/backfill`, {}, HubMediaBackfillStatusSchema);
}

/** Start a run: 202 with the running job; 409 `{ message, job }` while one runs. */
export function postHubMediaBackfill(guildId: number): Promise<HubMediaBackfillStatus> {
    return fetchApi(`${base(guildId)}/backfill`, { method: 'POST' }, HubMediaBackfillStatusSchema);
}

/** The running job a 409 carries, when its body parses; else null. */
export function runningJobOf(error: unknown): HubMediaBackfillStatus | null {
    const parsed = HubMediaBackfillStatusSchema.safeParse(errorBodyOf(error)?.job);
    return parsed.success ? parsed.data : null;
}
