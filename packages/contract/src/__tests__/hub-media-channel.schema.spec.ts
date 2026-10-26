import { describe, expect, it } from 'vitest';
import {
    HubMediaBackfillStatusSchema,
    HubMediaChannelStateSchema,
} from '../hub-media-channel.schema.js';

const state = {
    channelId: '123456789012345678',
    channelName: 'pictures',
    suggestedChannelId: null,
    setAt: '2026-10-25T10:00:00.000Z',
};

const summary = {
    scanned: 4, imagesStored: 3, duplicates: 1, deathsLinked: 1, deathsInferred: 0,
    unclassified: 2, failed: 0, oldestScannedAt: null, finishedAt: null,
};

describe('HubMediaChannelStateSchema (ROK-1941)', () => {
    it('accepts the API shape, including the OQ2 suggestion', () => {
        expect(HubMediaChannelStateSchema.parse(state)).toEqual(state);
    });

    it('refuses an unknown (renamed) field', () => {
        expect(HubMediaChannelStateSchema.safeParse({ ...state, botCanRead: true }).success).toBe(false);
    });
});

describe('HubMediaBackfillStatusSchema (ROK-1941)', () => {
    it('accepts a finished run', () => {
        const status = { state: 'done', startedAt: null, finishedAt: null, summary };
        expect(HubMediaBackfillStatusSchema.parse(status)).toEqual(status);
    });

    it('refuses a negative count and an unknown summary field', () => {
        const bad = (s: object) =>
            HubMediaBackfillStatusSchema.safeParse({ state: 'done', startedAt: null, finishedAt: null, summary: s });
        expect(bad({ ...summary, failed: -1 }).success).toBe(false);
        expect(bad({ ...summary, extra: 1 }).success).toBe(false);
    });
});
