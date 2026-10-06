/**
 * ROK-1629: anonymous viewers get the public roster projection (no Discord ids,
 * server-built avatar URL). The web must parse it, not throw SchemaValidationError.
 */
import { describe, it, expect } from 'vitest';
import { EventDetailResponseSchema } from '@raid-ledger/contract';
import { createMockEvent } from '../../test/factories';
import {
    ViewerEventDetailResponseSchema,
    ViewerEventListResponseSchema,
    ViewerEventRosterSchema,
} from './viewer-event-schemas';

const AVATAR = 'https://cdn.discordapp.com/avatars/111/abc.png';

const publicSignup = {
    id: 5, eventId: 1, user: { id: 10, username: 'Thrall', avatar: AVATAR },
    signedUpAt: '2026-02-01T00:00:00.000Z', characterId: null, character: null,
    confirmationStatus: 'confirmed', status: 'signed_up',
};
const publicAssignment = {
    id: 5, signupId: 5, userId: 10, username: 'Thrall', avatar: AVATAR, customAvatarUrl: null,
    slot: 'dps', position: 1, isOverride: false, character: null, preferredRoles: null,
};
const voiceChannel = { channelId: null, channelName: null, guildId: null };

function detail(signup: object, assignment: object) {
    return {
        event: createMockEvent(),
        roster: { eventId: 1, signups: [signup], count: 1 },
        rosterAssignments: { eventId: 1, pool: [], assignments: [assignment], slots: { dps: 1 } },
        pugs: [],
        voiceChannel,
    };
}

describe('ViewerEventDetailResponseSchema (ROK-1629)', () => {
    it('the member schema alone rejects the anonymous projection (why the union exists)', () => {
        expect(EventDetailResponseSchema.safeParse(detail(publicSignup, publicAssignment)).success).toBe(false);
    });

    it('parses the anonymous projection and keeps the server-built avatar', () => {
        const result = ViewerEventDetailResponseSchema.safeParse(detail(publicSignup, publicAssignment));
        expect(result.error?.issues ?? []).toEqual([]);
        expect(result.data?.roster.signups[0]?.user.avatar).toBe(AVATAR);
        expect(result.data?.rosterAssignments.assignments[0]?.avatar).toBe(AVATAR);
    });

    it('keeps discordId on the member payload', () => {
        const memberSignup = { ...publicSignup, note: null, user: { ...publicSignup.user, discordId: '111' } };
        const result = ViewerEventDetailResponseSchema.safeParse(
            detail(memberSignup, { ...publicAssignment, discordId: '111' }),
        );
        expect(result.data?.roster.signups[0]?.user.discordId).toBe('111');
        expect(result.data?.rosterAssignments.assignments[0]?.discordId).toBe('111');
    });
});

describe('ViewerEventRosterSchema / ViewerEventListResponseSchema (ROK-1629)', () => {
    it('parses an anonymous /events/:id/roster response', () => {
        const result = ViewerEventRosterSchema.safeParse({ eventId: 1, signups: [publicSignup], count: 1 });
        expect(result.error?.issues ?? []).toEqual([]);
    });

    it('parses an anonymous /events list whose signupsPreview has no discordId', () => {
        const event = createMockEvent({ signupsPreview: [{ id: 10, username: 'Thrall', avatar: AVATAR }] as never });
        const meta = { total: 1, page: 1, limit: 20, totalPages: 1, hasMore: false };
        const result = ViewerEventListResponseSchema.safeParse({ data: [event], meta });
        expect(result.error?.issues ?? []).toEqual([]);
    });
});
