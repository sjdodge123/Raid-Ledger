/**
 * Contract tests for ROK-1728 (series signup). Parse/refuse cases for the
 * new series-signup schemas and the additive fields on the signup/roster DTOs.
 *
 * Runs under the contract workspace's own vitest config.
 */
import { describe, it, expect } from 'vitest';
import {
    JoinSeriesSchema,
    SeriesSignupSchema,
    SeriesSignupStateSchema,
    JoinSeriesResponseSchema,
    LeaveSeriesResponseSchema,
} from '../series-signups.schema.js';
import { SignupResponseSchema } from '../signups.schema.js';
import { RosterAssignmentResponseSchema } from '../roster.schema.js';

const membership = {
    id: 1,
    recurrenceGroupId: '6f1c2c1e-6c3a-4e6b-9a8f-0d2a4b1c3e5f',
    userId: 7,
    characterId: null,
    preferredRoles: ['tank', 'dps'],
    status: 'active',
    endedReason: null,
    joinedAt: '2026-10-30T20:00:00.000Z',
    endedAt: null,
};

describe('JoinSeriesSchema', () => {
    it('accepts an empty body (both fields optional)', () => {
        expect(JoinSeriesSchema.parse({})).toEqual({});
    });

    it('strips per-night fields such as note and slotRole', () => {
        const parsed = JoinSeriesSchema.parse({ note: 'hi', slotRole: 'tank' });
        expect(parsed).not.toHaveProperty('note');
        expect(parsed).not.toHaveProperty('slotRole');
    });

    it('refuses a non-uuid characterId', () => {
        expect(JoinSeriesSchema.safeParse({ characterId: 'nope' }).success).toBe(false);
    });
});

describe('SeriesSignupSchema', () => {
    it('accepts an active membership', () => {
        expect(SeriesSignupSchema.parse(membership).status).toBe('active');
    });

    it('accepts an ended membership with a reason', () => {
        const ended = { ...membership, status: 'ended', endedReason: 'series_cancelled', endedAt: '2026-11-01T00:00:00.000Z' };
        expect(SeriesSignupSchema.parse(ended).endedReason).toBe('series_cancelled');
    });

    it('refuses an unknown status', () => {
        expect(SeriesSignupSchema.safeParse({ ...membership, status: 'completed' }).success).toBe(false);
    });

    it('refuses an unknown ended reason', () => {
        expect(SeriesSignupSchema.safeParse({ ...membership, endedReason: 'series_complete' }).success).toBe(false);
    });

    it('refuses a non-uuid recurrenceGroupId', () => {
        expect(SeriesSignupSchema.safeParse({ ...membership, recurrenceGroupId: 'abc' }).success).toBe(false);
    });
});

describe('SeriesSignupStateSchema', () => {
    const night = { eventId: 3, startTime: '2026-11-02T20:00:00.000Z', state: 'will_create', signupStatus: null };

    it('accepts a non-member state with nights', () => {
        const state = { membership: null, nights: [night], joinableCount: 1, firstNight: night.startTime, lastNight: night.startTime };
        expect(SeriesSignupStateSchema.parse(state).joinableCount).toBe(1);
    });

    it('refuses a negative joinableCount', () => {
        const state = { membership: null, nights: [], joinableCount: -1, firstNight: null, lastNight: null };
        expect(SeriesSignupStateSchema.safeParse(state).success).toBe(false);
    });

    it('refuses an unknown night state', () => {
        const state = { membership: null, nights: [{ ...night, state: 'joined' }], joinableCount: 0, firstNight: null, lastNight: null };
        expect(SeriesSignupStateSchema.safeParse(state).success).toBe(false);
    });
});

describe('Join / Leave responses', () => {
    it('accepts a join response with a failed night', () => {
        const res = { membership, attachedEventIds: [1], createdEventIds: [2], keptEventIds: [3], failed: [{ eventId: 4, message: 'Roster full' }] };
        expect(JoinSeriesResponseSchema.parse(res).failed).toHaveLength(1);
    });

    it('refuses a join response without a membership', () => {
        const res = { attachedEventIds: [], createdEventIds: [], keptEventIds: [], failed: [] };
        expect(JoinSeriesResponseSchema.safeParse(res).success).toBe(false);
    });

    it('accepts a leave response', () => {
        const res = { membership: { ...membership, status: 'left', endedReason: 'user_left' }, cancelledEventIds: [5, 6], lateCancelledEventIds: [5] };
        expect(LeaveSeriesResponseSchema.parse(res).lateCancelledEventIds).toEqual([5]);
    });
});

describe('additive fields on existing DTOs', () => {
    const signup = {
        id: 1,
        eventId: 2,
        user: { id: 3, discordId: '123', username: 'member', avatar: null },
        note: null,
        signedUpAt: '2026-06-28T20:00:00.000Z',
        characterId: null,
        character: null,
        confirmationStatus: 'pending' as const,
        status: 'signed_up' as const,
    };

    it('SignupResponseSchema accepts seriesSignupId, null and absent', () => {
        expect(SignupResponseSchema.parse({ ...signup, seriesSignupId: 9 }).seriesSignupId).toBe(9);
        expect(SignupResponseSchema.parse({ ...signup, seriesSignupId: null }).seriesSignupId).toBeNull();
        expect(SignupResponseSchema.parse(signup).seriesSignupId).toBeUndefined();
    });

    it('SignupResponseSchema refuses a non-positive seriesSignupId', () => {
        expect(SignupResponseSchema.safeParse({ ...signup, seriesSignupId: 0 }).success).toBe(false);
    });

    it('RosterAssignmentResponseSchema exposes optional inSeries', () => {
        expect(RosterAssignmentResponseSchema.shape.inSeries.safeParse(true).success).toBe(true);
        expect(RosterAssignmentResponseSchema.shape.inSeries.safeParse(undefined).success).toBe(true);
        expect(RosterAssignmentResponseSchema.shape.inSeries.safeParse('yes').success).toBe(false);
    });
});
