/**
 * ROK-1874: the over-cap arithmetic must agree with the API —
 * `rostered = 1 + yes-voters excluding the creator`,
 * `cap = min(slotPlayer, maxAttendees)` over whichever is set and > 0.
 */
import { describe, it, expect } from 'vitest';
import type { SchedulePollPageResponseDto, ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { computeSchedulingOverflow, findSlotByTime, resolveRosterCap } from './use-scheduling-overflow';
import { partialResult } from '../../test/partial-result';

const CREATOR = 1;
const TIME = '2035-06-10T20:00:00.000Z';

function slot(voterIds: number[], proposedTime = TIME): ScheduleSlotWithVotesDto {
    return {
        id: 9, matchId: 5, proposedTime, overlapScore: 0, suggestedBy: 'system',
        createdAt: '2026-05-16T00:00:00.000Z', noVotes: [],
        votes: voterIds.map((userId) => ({ userId, displayName: `User ${userId}`, avatar: null, discordId: null, customAvatarUrl: null })),
    };
}

const generic = (slotPlayer: number, maxAttendees: string) => ({ slotType: 'generic' as const, slotPlayer, maxAttendees });

describe('resolveRosterCap', () => {
    it.each([
        [4, '', 4], [0, '6', 6], [4, '3', 3], [5, '8', 5], [0, '', null], [0, '0', null], [3, 'abc', 3],
    ])('slotPlayer %s, maxAttendees %j → %s', (player, max, want) => {
        expect(resolveRosterCap(player, max)).toBe(want);
    });
});

describe('computeSchedulingOverflow', () => {
    it('creator voted: 4-spot roster, 5 yes-votes incl. creator → 1 benched', () => {
        expect(computeSchedulingOverflow(slot([1, 2, 3, 4, 5]), CREATOR, generic(4, '4'))).toEqual({
            voters: ['User 2', 'User 3', 'User 4', 'User 5'], rostered: 5, cap: 4, benched: 1, creatorVoted: true,
        });
    });

    it('creator did NOT vote: they still take a spot', () => {
        expect(computeSchedulingOverflow(slot([2, 3, 4]), CREATOR, generic(3, ''))).toEqual({
            voters: ['User 2', 'User 3', 'User 4'], rostered: 4, cap: 3, benched: 1, creatorVoted: false,
        });
    });

    it('takes the cap from maxAttendees when slotPlayer is unset', () => {
        expect(computeSchedulingOverflow(slot([1, 2, 3, 4]), CREATOR, generic(0, '2'))?.benched).toBe(2);
    });

    it('takes the smaller of the two caps', () => {
        expect(computeSchedulingOverflow(slot([1, 2, 3, 4]), CREATOR, generic(10, '3'))?.cap).toBe(3);
    });

    it('counts a duplicated voter once', () => {
        expect(computeSchedulingOverflow(slot([1, 2, 2, 3]), CREATOR, generic(2, ''))?.rostered).toBe(3);
    });

    it.each([
        ['nothing benched', slot([1, 2, 3, 4]), generic(4, '4')],
        ['mmo roster', slot([1, 2, 3, 4, 5]), { slotType: 'mmo' as const, slotPlayer: 2, maxAttendees: '2' }],
        ['no cap set', slot([1, 2, 3, 4, 5]), generic(0, '')],
        ['slot not found', undefined, generic(2, '2')],
    ])('null when %s', (_label, s, roster) => {
        expect(computeSchedulingOverflow(s, CREATOR, roster)).toBeNull();
    });
});

describe('findSlotByTime', () => {
    it('matches by instant, not by string', () => {
        const poll = partialResult<SchedulePollPageResponseDto>({ slots: [slot([1], '2035-06-10T20:00:00Z'), slot([2], '2035-06-11T20:00:00.000Z')] });
        expect(findSlotByTime(poll, TIME)?.votes[0]?.userId).toBe(1);
        expect(findSlotByTime(poll, '2035-06-12T20:00:00.000Z')).toBeUndefined();
    });
});
