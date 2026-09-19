/**
 * ROK-1618 — the Rally row's audience must match the SERVER's.
 *
 * The server nudges members with no stance on any still-FUTURE slot. The
 * poll-wide `uniqueVoterCount` the Remind row uses has no time filter, so a
 * member whose only vote sits on a slot that has since passed counted as
 * "answered" and the row disabled itself with "Everyone has voted" while the
 * server still had a whole roster to nudge.
 */
import { describe, it, expect } from 'vitest';
import { rallyPendingCount } from '../scheduling-manage.helpers';

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const PAST = '2026-06-09T20:00:00.000Z';
const FUTURE = '2026-06-11T20:00:00.000Z';

const members = [{ userId: 1 }, { userId: 2 }, { userId: 3 }];

function slot(proposedTime: string, yes: number[], no: number[] = []) {
    return {
        proposedTime,
        votes: yes.map((userId) => ({ userId })),
        noVotes: no.map((userId) => ({ userId })),
    };
}

describe('rallyPendingCount', () => {
    it('counts only members with no stance on a FUTURE slot', () => {
        const slots = [slot(FUTURE, [2])];
        expect(rallyPendingCount({ members, slots, viewerId: null, now: NOW })).toBe(2);
    });

    it('treats a NO as answered (ROK-1617)', () => {
        const slots = [slot(FUTURE, [], [2, 3])];
        expect(rallyPendingCount({ members, slots, viewerId: null, now: NOW })).toBe(1);
    });

    it('still counts a member whose only vote is on a slot that has passed', () => {
        // The regression: `uniqueVoterCount` says everybody voted.
        const slots = [slot(PAST, [1, 2, 3]), slot(FUTURE, [])];
        expect(rallyPendingCount({ members, slots, viewerId: null, now: NOW })).toBe(3);
    });

    it('excludes the viewer, who is never nudged by their own rally', () => {
        const slots = [slot(FUTURE, [])];
        expect(rallyPendingCount({ members, slots, viewerId: 1, now: NOW })).toBe(2);
    });

    it('answers undefined when members are unknown or no future slot exists', () => {
        expect(
            rallyPendingCount({
                members: undefined,
                slots: [slot(FUTURE, [])],
                viewerId: null,
                now: NOW,
            }),
        ).toBeUndefined();
        expect(
            rallyPendingCount({
                members,
                slots: [slot(PAST, [])],
                viewerId: null,
                now: NOW,
            }),
        ).toBeUndefined();
    });
});
