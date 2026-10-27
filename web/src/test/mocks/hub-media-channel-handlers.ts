/**
 * ROK-1941 — default hub "Pictures" channel handlers: nothing bound, no
 * mirror suggestion, no backfill run yet. Specs override with `server.use()`;
 * the builders below shape the payloads.
 */
import { http, HttpResponse } from 'msw';
import type {
    HubMediaBackfillStatus, HubMediaBackfillSummary, HubMediaChannelState,
} from '../../components/hub/settings/hub-media-channel-api';

const GUILDS = 'http://localhost:3000/guilds';

export function mediaChannelState(overrides: Partial<HubMediaChannelState> = {}): HubMediaChannelState {
    return { channelId: null, channelName: null, suggestedChannelId: null, setAt: null, ...overrides };
}

export function backfillSummary(overrides: Partial<HubMediaBackfillSummary> = {}): HubMediaBackfillSummary {
    return {
        scanned: 40, imagesStored: 12, duplicates: 3, deathsLinked: 5, deathsInferred: 2, unclassified: 1, failed: 1,
        oldestScannedAt: '2026-10-04T12:00:00.000Z', finishedAt: null, ...overrides,
    };
}

export function backfillStatus(
    state: HubMediaBackfillStatus['state'], summary: HubMediaBackfillSummary | null = null,
): HubMediaBackfillStatus {
    const startedAt = state === 'idle' ? null : '2026-10-25T10:00:00.000Z';
    const finishedAt = state === 'done' || state === 'failed' ? '2026-10-25T10:05:00.000Z' : null;
    return { state, startedAt, finishedAt, summary };
}

export const hubMediaChannelHandlers = [
    http.get(`${GUILDS}/:id/media-channel`, () => HttpResponse.json(mediaChannelState())),
    http.get(`${GUILDS}/:id/media-channel/backfill`, () => HttpResponse.json(backfillStatus('idle'))),
];
