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
