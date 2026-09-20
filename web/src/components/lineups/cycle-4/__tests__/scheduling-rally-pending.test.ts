/**
 * ROK-1618 — the Rally row's audience is THE LEADING SLOT's non-answerers.
 *
 * The first cut counted members with no stance on ANY future slot, and the
 * operator rejected it on prod: the leading time read "3 of 4 members picked
 * this time" while Rally sat disabled saying "Everyone has voted", because
 * member 4 had voted on a DIFFERENT time. Rally's job is to get the leading
 * time over the line, so its audience is everyone with no YES and no NO on
 * that one slot.
 */
import { describe, it, expect } from 'vitest';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import {
    rallyLeadingSlotId,
    rallyPendingCount,
} from '../scheduling-manage.helpers';

const LEADER_ID = 10;
const OTHER_ID = 11;

const members = [{ userId: 1 }, { userId: 2 }, { userId: 3 }];
/** The prod shape: four members, three of them on the leading time. */
const fourMembers = [...members, { userId: 4 }];

function slot(id: number, yes: number[], no: number[] = []) {
    return {
        id,
        votes: yes.map((userId) => ({ userId })),
        noVotes: no.map((userId) => ({ userId })),
    };
}

describe('rallyPendingCount', () => {
    it('counts the members with no stance on the LEADING slot', () => {
        const slots = [slot(LEADER_ID, [2])];
        expect(
            rallyPendingCount({
                members,
                slots,
                viewerId: null,
                leadingSlotId: LEADER_ID,
            }),
        ).toBe(2);
    });

    it('counts a member whose only vote is on another slot (the prod 3-of-4)', () => {
        // The regression: the old any-future-slot rule answered 0 here and
        // disabled the row, even though member 4 never answered the leader.
        const slots = [slot(LEADER_ID, [1, 2, 3]), slot(OTHER_ID, [4])];
        expect(
            rallyPendingCount({
                members: fourMembers,
                slots,
                viewerId: null,
                leadingSlotId: LEADER_ID,
            }),
        ).toBe(1);
    });

    it('treats a NO on the leading slot as answered (ROK-1617)', () => {
        const slots = [slot(LEADER_ID, [], [2, 3])];
        expect(
            rallyPendingCount({
                members,
                slots,
                viewerId: null,
                leadingSlotId: LEADER_ID,
            }),
        ).toBe(1);
    });

    it('does NOT treat a NO on another slot as answering the leader', () => {
        const slots = [slot(LEADER_ID, [1]), slot(OTHER_ID, [], [2, 3])];
        expect(
            rallyPendingCount({
                members,
                slots,
                viewerId: null,
                leadingSlotId: LEADER_ID,
            }),
        ).toBe(2);
    });

    it('excludes the viewer, who is never nudged by their own rally', () => {
        const slots = [slot(LEADER_ID, [])];
        expect(
            rallyPendingCount({
                members,
                slots,
                viewerId: 1,
                leadingSlotId: LEADER_ID,
            }),
        ).toBe(2);
    });

    it('answers undefined when the members or the leading slot are unknown', () => {
        expect(
            rallyPendingCount({
                members: undefined,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                leadingSlotId: LEADER_ID,
            }),
        ).toBeUndefined();
        expect(
            rallyPendingCount({
                members,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                leadingSlotId: null,
            }),
        ).toBeUndefined();
        // Leader id that is not in `slots` — a stale render; stay enabled and
        // let the server's answer drive the toast.
        expect(
            rallyPendingCount({
                members,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                leadingSlotId: OTHER_ID,
            }),
        ).toBeUndefined();
    });
});

/**
 * The page must rally the slot the SERVER rallies (`pickLeadingFutureSlot`:
 * future, >= 1 YES, shared order) — not the leader card's slot, which ranks
 * every slot. Review finding on the follow-up: with those two apart the row
 * counts one time while the DM names another.
 */
describe('rallyLeadingSlotId', () => {
    const NOW = Date.parse('2026-09-20T12:00:00Z');
    const FUTURE_A = '2026-09-22T20:00:00Z';
    const FUTURE_B = '2026-09-23T20:00:00Z';
    const PAST = '2026-09-18T20:00:00Z';

    function dto(
        id: number,
        proposedTime: string,
        yes: number[],
        no: number[] = [],
    ): ScheduleSlotWithVotesDto {
        const voter = (userId: number) => ({
            userId,
            displayName: `u${userId}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });
        return {
            id,
            matchId: 1,
            proposedTime,
            suggestedBy: 'user',
            createdAt: PAST,
            votes: yes.map(voter),
            noVotes: no.map(voter),
        } as ScheduleSlotWithVotesDto;
    }

    it('picks the most-voted future slot', () => {
        const slots = [dto(1, FUTURE_A, [1]), dto(2, FUTURE_B, [1, 2, 3])];
        expect(rallyLeadingSlotId(slots, NOW)).toBe(2);
    });

    it('skips a top-voted slot that has already passed', () => {
        // The leader CARD would name slot 1; the server rallies slot 2.
        const slots = [dto(1, PAST, [1, 2, 3]), dto(2, FUTURE_A, [4])];
        expect(rallyLeadingSlotId(slots, NOW)).toBe(2);
    });

    it('answers null when no future slot has a YES — the server would 400', () => {
        const slots = [dto(1, FUTURE_A, []), dto(2, FUTURE_B, [], [3])];
        expect(rallyLeadingSlotId(slots, NOW)).toBeNull();
        expect(
            rallyPendingCount({
                members,
                slots,
                viewerId: null,
                leadingSlotId: rallyLeadingSlotId(slots, NOW),
            }),
        ).toBeUndefined();
    });

    // ROK-1617 item D: the server's leader now clears `leadsAtAll` (net > 0),
    // so a mostly-`no` time is NOT the slot Rally would nudge about.
    it('answers null when the only future slot is net-negative', () => {
        const slots = [dto(1, FUTURE_A, [1], [2, 3, 4])];
        expect(rallyLeadingSlotId(slots, NOW)).toBeNull();
    });

    it('skips a net-negative slot for one the server would rally', () => {
        const slots = [dto(1, FUTURE_A, [1, 2], [3, 4, 5]), dto(2, FUTURE_B, [6])];
        expect(rallyLeadingSlotId(slots, NOW)).toBe(2);
    });

    it('counts non-answerers on the FUTURE leader, not the past top slot', () => {
        // Members 1-3 all voted on the passed slot; only 4 is on the future one.
        const slots = [dto(1, PAST, [1, 2, 3]), dto(2, FUTURE_A, [4])];
        expect(
            rallyPendingCount({
                members: fourMembers,
                slots,
                viewerId: null,
                leadingSlotId: rallyLeadingSlotId(slots, NOW),
            }),
        ).toBe(3);
    });
});
