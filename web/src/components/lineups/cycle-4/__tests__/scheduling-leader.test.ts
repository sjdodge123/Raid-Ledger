/**
 * Leader/tie derivation for the ROK-1543 Layout-B scheduling poll.
 *
 * `deriveSchedulingLeader` is the ONE place the page decides which slot is
 * winning and whether the top two are level — ROK-1548 swaps the comparator
 * for the shared one by changing `sortSlots` here and nowhere else.
 */
import { describe, it, expect } from 'vitest';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { deriveSchedulingLeader, sortSlots } from '../scheduling-leader';
import { rallyLeadingSlotId } from '../scheduling-manage.helpers';

/** Build a slot with `voteCount` synthetic voters. */
function makeSlot(
  id: number,
  proposedTime: string,
  voteCount: number,
): ScheduleSlotWithVotesDto {
  return {
    id,
    matchId: 500,
    proposedTime,
    overlapScore: 0,
    suggestedBy: 'user',
    createdAt: '2026-06-01T00:00:00.000Z',
    votes: Array.from({ length: voteCount }, (_, i) => ({
      userId: i + 1,
      displayName: `User ${i + 1}`,
      avatar: null,
      discordId: null,
      customAvatarUrl: null,
    })),
  } as unknown as ScheduleSlotWithVotesDto;
}

const EARLY = '2026-07-01T18:00:00.000Z';
const LATE = '2026-07-02T18:00:00.000Z';

describe('sortSlots', () => {
  it('orders by votes desc, then proposed time asc', () => {
    const slots = [
      makeSlot(1, LATE, 1),
      makeSlot(2, EARLY, 1),
      makeSlot(3, EARLY, 3),
    ];
    expect(sortSlots(slots).map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const slots = [makeSlot(1, LATE, 0), makeSlot(2, EARLY, 5)];
    sortSlots(slots);
    expect(slots.map((s) => s.id)).toEqual([1, 2]);
  });
});

describe('deriveSchedulingLeader', () => {
  it('returns null when there are no slots', () => {
    expect(deriveSchedulingLeader([])).toBeNull();
  });

  it('picks the most-voted slot', () => {
    const leader = deriveSchedulingLeader([
      makeSlot(1, EARLY, 1),
      makeSlot(2, LATE, 4),
    ]);
    expect(leader?.slot.id).toBe(2);
    expect(leader?.votes).toBe(4);
    expect(leader?.tied).toBe(false);
  });

  it('breaks a tie on the earliest proposed time and flags it', () => {
    const leader = deriveSchedulingLeader([
      makeSlot(1, LATE, 2),
      makeSlot(2, EARLY, 2),
    ]);
    expect(leader?.slot.id).toBe(2);
    expect(leader?.tied).toBe(true);
  });

  it('is not a tie when nobody has voted yet', () => {
    const leader = deriveSchedulingLeader([
      makeSlot(1, EARLY, 0),
      makeSlot(2, LATE, 0),
    ]);
    expect(leader?.slot.id).toBe(1);
    expect(leader?.votes).toBe(0);
    expect(leader?.tied).toBe(false);
  });

  it('is not a tie with a single slot', () => {
    expect(deriveSchedulingLeader([makeSlot(1, EARLY, 2)])?.tied).toBe(false);
  });
});

describe('net score (ROK-1617)', () => {
    /** Slot factory: `yes`/`no` counts only — identity never matters here. */
    function slot(
        id: number,
        proposedTime: string,
        yes: number,
        no: number,
    ): ScheduleSlotWithVotesDto {
        const voter = (userId: number): ScheduleSlotWithVotesDto['votes'][number] => ({
            userId,
            displayName: `U${userId}`,
            avatar: null,
            discordId: null,
            customAvatarUrl: null,
        });
        return {
            id,
            matchId: 1,
            proposedTime,
            overlapScore: null,
            suggestedBy: 'user',
            createdAt: '2026-01-01T00:00:00.000Z',
            votes: Array.from({ length: yes }, (_, i) => voter(100 + i)),
            noVotes: Array.from({ length: no }, (_, i) => voter(200 + i)),
        };
    }

    it('sinks a slot whose anti-votes cancel its support', () => {
        // 3 yes / 2 no (net 1) must LOSE to 2 yes / 0 no (net 2). Counting only
        // `votes` — the un-wired behaviour — puts slot 1 first.
        const sorted = sortSlots([
            slot(1, '2030-06-10T20:00:00.000Z', 3, 2),
            slot(2, '2030-06-11T20:00:00.000Z', 2, 0),
        ]);
        expect(sorted.map((s) => s.id)).toEqual([2, 1]);
    });

    it('does not call a leader tied with a runner-up it out-nets', () => {
        const leader = deriveSchedulingLeader([
            slot(1, '2030-06-10T20:00:00.000Z', 3, 0),
            slot(2, '2030-06-11T20:00:00.000Z', 3, 1),
        ]);
        expect(leader?.slot.id).toBe(1);
        expect(leader?.tied).toBe(false);
        expect(leader?.noVotes).toBe(0);
    });

    it('has no leader when every answered time is net-negative', () => {
        // Operator ruling (item D): "No time worked" — a 1-yes/3-no time is
        // not "the leading time" on any surface.
        expect(
            deriveSchedulingLeader([slot(1, '2030-06-10T20:00:00.000Z', 1, 3)]),
        ).toBeNull();
    });

    it('has no leader at net 0 with yes votes (D-Q1 ruling)', () => {
        expect(
            deriveSchedulingLeader([slot(1, '2030-06-10T20:00:00.000Z', 2, 2)]),
        ).toBeNull();
    });

    it('leads with the positive-net time when another is rejected', () => {
        const leader = deriveSchedulingLeader([
            slot(1, '2030-06-10T20:00:00.000Z', 1, 3),
            slot(2, '2030-06-11T20:00:00.000Z', 1, 0),
        ]);
        expect(leader?.slot.id).toBe(2);
    });

    it('keeps the provisional top slot while nobody has answered', () => {
        // A poll nobody has opened is not a poll where "no time worked" — the
        // card still names the earliest proposed time with "no votes yet".
        const leader = deriveSchedulingLeader([
            slot(1, '2030-06-10T20:00:00.000Z', 0, 0),
            slot(2, '2030-06-11T20:00:00.000Z', 0, 0),
        ]);
        expect(leader?.slot.id).toBe(1);
        expect(leader?.votes).toBe(0);
    });

    it('still ties when the net scores match', () => {
        const leader = deriveSchedulingLeader([
            slot(1, '2030-06-10T20:00:00.000Z', 3, 1),
            slot(2, '2030-06-11T20:00:00.000Z', 2, 0),
        ]);
        expect(leader?.slot.id).toBe(1);
        expect(leader?.tied).toBe(true);
        expect(leader?.noVotes).toBe(1);
    });
});

/**
 * ROK-1617 follow-up (item 3, from the API reviewer): the server's
 * `pickLeadingFutureSlot` only ranks times that are still ahead. The web
 * leader did not, so the card could name a past time — and Rally, which
 * rallies the FUTURE leader, then 400s on a slot the card never showed.
 */
describe('future-only leader (ROK-1617 follow-up, item 3)', () => {
  const NOW = Date.parse('2026-09-20T12:00:00.000Z');
  const PAST = '2026-09-19T20:00:00.000Z';
  const FUTURE = '2026-09-21T20:00:00.000Z';
  const LATER = '2026-09-22T20:00:00.000Z';

  it('never leads with a time that has already passed', () => {
    const leader = deriveSchedulingLeader(
      [makeSlot(1, PAST, 5), makeSlot(2, FUTURE, 1)],
      NOW,
    );
    expect(leader?.slot.id).toBe(2);
    expect(leader?.votes).toBe(1);
  });

  it('leads with the best FUTURE time, not the best time overall', () => {
    const leader = deriveSchedulingLeader(
      [makeSlot(1, PAST, 9), makeSlot(2, LATER, 3), makeSlot(3, FUTURE, 1)],
      NOW,
    );
    expect(leader?.slot.id).toBe(2);
  });

  it('names the same slot Rally posts to', () => {
    const slots = [makeSlot(1, PAST, 5), makeSlot(2, FUTURE, 1)];
    expect(rallyLeadingSlotId(slots, NOW)).toBe(
      deriveSchedulingLeader(slots, NOW)?.slot.id,
    );
  });

  it('falls back to the full ladder once every time has passed', () => {
    // A locked-in or expired poll still has to name the time it ran on —
    // "No time works for the group yet." would be a lie about a finished
    // poll, and the card's "This time has already passed." marker is what
    // flags it instead.
    const leader = deriveSchedulingLeader(
      [makeSlot(1, PAST, 5), makeSlot(2, '2026-09-18T20:00:00.000Z', 1)],
      NOW,
    );
    expect(leader?.slot.id).toBe(1);
  });
});
