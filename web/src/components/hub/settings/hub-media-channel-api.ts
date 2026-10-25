/**
 * ROK-1941 D2 — the hub's Leader-set Discord "Pictures" channel and its
 * 21-day backfill (`guilds/:id/media-channel[/backfill]`). Every response is
 * parsed against the strict contract schemas (`hub-media-channel.schema.ts`).
 */
import {
    HubMediaBackfillStatusSchema,
    HubMediaChannelStateSchema,
    type HubMediaBackfillStatus,
    type HubMediaChannelState,
} from '@raid-ledger/contract';
import { fetchApi } from '../../../lib/api-client';
import { errorBodyOf } from '../../../lib/api/api-error';

export type { HubMediaBackfillStatus, HubMediaBackfillSummary, HubMediaChannelState } from '@raid-ledger/contract';

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
