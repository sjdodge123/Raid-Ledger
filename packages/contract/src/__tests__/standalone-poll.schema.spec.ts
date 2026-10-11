/**
 * Contract tests for private standalone polls shareable by link (ROK-1750).
 *
 * Pins the additive fields on the create / response / active / poll-page
 * schemas, the "reschedule polls can't be private" refine (ruling R3), and
 * the three new share-link schemas.
 */
import { describe, it, expect } from 'vitest';
import {
    CreateSchedulingPollSchema,
    SchedulingPollResponseSchema,
    ActiveStandalonePollSchema,
    PollSharePreviewSchema,
    PollShareJoinResponseSchema,
    PollShareTokenResponseSchema,
} from '../standalone-poll.schema.js';
import { SchedulePollPageResponseSchema } from '../lineup-scheduling.schema.js';

const TOKEN = 'a'.repeat(43);

describe('CreateSchedulingPollSchema visibility (ROK-1750)', () => {
    it('accepts a body with no visibility (defaults to public server-side)', () => {
        const r = CreateSchedulingPollSchema.safeParse({ gameId: 1 });
        expect(r.success).toBe(true);
        expect(r.data?.visibility).toBeUndefined();
    });

    it('accepts visibility private without linkedEventId', () => {
        const r = CreateSchedulingPollSchema.safeParse({ gameId: 1, visibility: 'private' });
        expect(r.data?.visibility).toBe('private');
    });

    it('accepts visibility public with linkedEventId (reschedule)', () => {
        const r = CreateSchedulingPollSchema.safeParse({
            gameId: 1,
            linkedEventId: 9,
            visibility: 'public',
        });
        expect(r.success).toBe(true);
    });

    it('rejects private + linkedEventId on the visibility path', () => {
        const r = CreateSchedulingPollSchema.safeParse({
            gameId: 1,
            linkedEventId: 9,
            visibility: 'private',
        });
        expect(r.success).toBe(false);
        expect(r.error?.issues[0]?.path).toEqual(['visibility']);
    });

    it('rejects an unknown visibility value', () => {
        const r = CreateSchedulingPollSchema.safeParse({ gameId: 1, visibility: 'secret' });
        expect(r.success).toBe(false);
    });
});

describe('SchedulingPollResponseSchema share fields (ROK-1750)', () => {
    const base = {
        id: 1,
        lineupId: 2,
        gameId: 3,
        gameName: 'Valheim',
        gameCoverUrl: null,
        memberCount: 1,
        status: 'scheduling' as const,
        createdAt: '2026-10-10T00:00:00.000Z',
    };

    it('accepts a private poll carrying a token', () => {
        const r = SchedulingPollResponseSchema.safeParse({
            ...base,
            visibility: 'private',
            shareToken: TOKEN,
        });
        expect(r.data?.shareToken).toBe(TOKEN);
    });

    it('accepts a public poll with a null token', () => {
        const r = SchedulingPollResponseSchema.safeParse({
            ...base,
            visibility: 'public',
            shareToken: null,
        });
        expect(r.success).toBe(true);
    });

    it('requires visibility and shareToken keys', () => {
        expect(SchedulingPollResponseSchema.safeParse(base).success).toBe(false);
    });
});

describe('ActiveStandalonePollSchema visibility (ROK-1750)', () => {
    const base = {
        matchId: 1,
        lineupId: 2,
        gameName: 'Valheim',
        gameCoverUrl: null,
        memberCount: 2,
        slotCount: 3,
    };

    it('keeps visibility optional', () => {
        expect(ActiveStandalonePollSchema.safeParse(base).success).toBe(true);
        const r = ActiveStandalonePollSchema.safeParse({ ...base, visibility: 'private' });
        expect(r.data?.visibility).toBe('private');
    });
});

describe('SchedulePollPageResponseSchema share fields (ROK-1750)', () => {
    const shape = SchedulePollPageResponseSchema.shape;

    it('accepts visibility and a nullable, optional shareToken', () => {
        expect(shape.visibility.safeParse(undefined).success).toBe(true);
        expect(shape.visibility.safeParse('private').success).toBe(true);
        expect(shape.visibility.safeParse('secret').success).toBe(false);
        expect(shape.shareToken.safeParse(undefined).success).toBe(true);
        expect(shape.shareToken.safeParse(null).success).toBe(true);
        expect(shape.shareToken.safeParse(TOKEN).success).toBe(true);
    });
});

describe('Share-link schemas (ROK-1750)', () => {
    it('PollSharePreviewSchema strips anything beyond the minimal projection', () => {
        const r = PollSharePreviewSchema.parse({
            gameName: 'Valheim',
            gameCoverUrl: null,
            creatorDisplayName: 'Roknua',
            isOpen: true,
            memberCount: 4,
            slots: [{ id: 1 }],
            discordId: '123',
        });
        expect(Object.keys(r).sort()).toEqual([
            'creatorDisplayName',
            'gameCoverUrl',
            'gameName',
            'isOpen',
            'memberCount',
        ]);
    });

    it('PollShareJoinResponseSchema requires positive ids and a joined flag', () => {
        expect(
            PollShareJoinResponseSchema.safeParse({ lineupId: 1, matchId: 2, joined: false })
                .success,
        ).toBe(true);
        expect(
            PollShareJoinResponseSchema.safeParse({ lineupId: 0, matchId: 2, joined: true })
                .success,
        ).toBe(false);
    });

    it('PollShareTokenResponseSchema rejects an empty token', () => {
        expect(PollShareTokenResponseSchema.safeParse({ shareToken: TOKEN }).success).toBe(true);
        expect(PollShareTokenResponseSchema.safeParse({ shareToken: '' }).success).toBe(false);
    });
});
