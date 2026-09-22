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
import { rallyPendingCount } from '../scheduling-manage.helpers';

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
                slotId: LEADER_ID,
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
                slotId: LEADER_ID,
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
                slotId: LEADER_ID,
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
                slotId: LEADER_ID,
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
                slotId: LEADER_ID,
            }),
        ).toBe(2);
    });

    it('answers undefined when the members or the leading slot are unknown', () => {
        expect(
            rallyPendingCount({
                members: undefined,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                slotId: LEADER_ID,
            }),
        ).toBeUndefined();
        expect(
            rallyPendingCount({
                members,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                slotId: null,
            }),
        ).toBeUndefined();
        // Leader id that is not in `slots` — a stale render; stay enabled and
        // let the server's answer drive the toast.
        expect(
            rallyPendingCount({
                members,
                slots: [slot(LEADER_ID, [])],
                viewerId: null,
                slotId: OTHER_ID,
            }),
        ).toBeUndefined();
    });
});
