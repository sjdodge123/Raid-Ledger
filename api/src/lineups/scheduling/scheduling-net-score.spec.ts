/**
 * ROK-1617 AC3: the leading calculation under the NET SCORE ruling.
 *
 * Operator ruling 2026-09-18: leading is `yes - no`. Not yes-only, not a
 * ratio, and NOT a veto — a `no` lowers a slot, it does not disqualify it.
 * These assertions pin that ruling, and pin that adding it did not disturb
 * the existing tie-break (earliest time, then id) which keeps the order
 * total and stable between renders.
 */
import { slotNetScore, sortSchedulingSlots } from '@raid-ledger/contract';

const at = (h: number) => `2026-09-20T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('slotNetScore', () => {
  it('is yes minus no', () => {
    expect(
      slotNetScore({ id: 1, proposedTime: at(1), voteCount: 3, noCount: 1 }),
    ).toBe(2);
  });

  it('treats an absent noCount as zero, preserving pre-stance ordering', () => {
    expect(slotNetScore({ id: 1, proposedTime: at(1), voteCount: 3 })).toBe(3);
  });

  it('goes negative when a slot is mostly no', () => {
    expect(
      slotNetScore({ id: 1, proposedTime: at(1), voteCount: 1, noCount: 3 }),
    ).toBe(-2);
  });
});

describe('sortSchedulingSlots — net score', () => {
  it('ranks 3 yes / 0 no above 3 yes / 1 no', () => {
    // The story's own worked example: net 3 beats net 2 even though both
    // slots have the same number of people who WANT them.
    const sorted = sortSchedulingSlots([
      { id: 1, proposedTime: at(1), voteCount: 3, noCount: 1 },
      { id: 2, proposedTime: at(2), voteCount: 3, noCount: 0 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it('does NOT let a single no veto a strongly-liked slot', () => {
    // Option 2 (veto) was explicitly rejected. 5 yes / 1 no (net 4) must
    // still beat an unopposed 1 yes (net 1).
    const sorted = sortSchedulingSlots([
      { id: 1, proposedTime: at(3), voteCount: 1, noCount: 0 },
      { id: 2, proposedTime: at(4), voteCount: 5, noCount: 1 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it('sinks an all-no slot below an unanswered one', () => {
    const sorted = sortSchedulingSlots([
      { id: 1, proposedTime: at(5), voteCount: 0, noCount: 3 },
      { id: 2, proposedTime: at(6), voteCount: 0, noCount: 0 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual([2, 1]);
  });

  it('breaks a NET tie by earliest time, then id — deterministically', () => {
    // 2 yes / 1 no and 1 yes / 0 no both net 1. The tie must fall to the
    // earliest time, and two slots at the SAME instant to the lower id, so
    // the order never swaps between renders or between surfaces.
    const slots = [
      { id: 9, proposedTime: at(8), voteCount: 2, noCount: 1 },
      { id: 4, proposedTime: at(8), voteCount: 1, noCount: 0 },
      { id: 7, proposedTime: at(7), voteCount: 3, noCount: 2 },
    ];
    expect(sortSchedulingSlots(slots).map((s) => s.id)).toEqual([7, 4, 9]);
    // Same input, shuffled — same output.
    expect(sortSchedulingSlots([...slots].reverse()).map((s) => s.id)).toEqual([
      7, 4, 9,
    ]);
  });
});
