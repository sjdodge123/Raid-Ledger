/**
 * ROK-1548 (P2-1) — one slot order across the web page, the Discord embed and
 * lock-in (audit F-03, F-15; principle P-5).
 *
 * The fixture is a THREE-WAY tie on votes so every key of the shared
 * comparator is exercised: votes desc, then `proposedTime` asc, then `id` asc.
 * Input order is deliberately the "DB order" a stable sort would preserve, so
 * a comparator missing a secondary key cannot satisfy these assertions.
 *
 * The identical fixture + expected order is pinned on the web call site in
 * `web/src/components/lineups/cycle-4/__tests__/SchedulingSlotList.order.test.tsx`.
 */
import {
  compareSchedulingSlots,
  sortSchedulingSlots,
  SLOT_TIE_RULE,
} from '@raid-ledger/contract';
import {
  buildSchedulingPollEmbedBody,
  schedulingPollAuthorLine,
} from './discord-embed-scheduling.helpers';
import { buildEmbedSlots } from '../../lineups/scheduling/scheduling-poll-embed.helpers';
import type { SchedulingPollEmbedData } from './discord-embed-scheduling.types';

/** Discord timestamp token for an ISO instant, as the description renders it. */
function unix(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>`;
}

/** Two instants; the tie fixture reuses them so `id` decides the last pair. */
const EARLY = '2026-04-10T19:00:00.000Z';
const LATE = '2026-04-11T20:00:00.000Z';
const TOP = '2026-04-12T18:00:00.000Z';

/** Shared tie fixture — see file docstring. Insertion order ≠ display order. */
const TIE_SLOTS = [
  { id: 9, proposedTime: LATE, voteCount: 3, voterNames: ['Ana'] },
  { id: 4, proposedTime: EARLY, voteCount: 3, voterNames: ['Bo', 'Cy'] },
  { id: 1, proposedTime: LATE, voteCount: 3, voterNames: [] },
  { id: 8, proposedTime: TOP, voteCount: 5, voterNames: ['Dee'] },
];

/** The ONE order every surface must render. */
const EXPECTED_ORDER = [8, 4, 1, 9];

function pollData(
  overrides: Partial<SchedulingPollEmbedData> = {},
): SchedulingPollEmbedData {
  return {
    matchId: 10,
    lineupId: 1,
    gameName: 'Elden Ring',
    pollUrl: 'http://localhost:5173/community-lineup/1/schedule/10',
    status: 'open',
    slots: TIE_SLOTS,
    uniqueVoterCount: 4,
    ...overrides,
  };
}

const context = {
  communityName: 'Test Guild',
  clientUrl: 'http://localhost:5173',
};

describe('ROK-1548 — shared scheduling slot order', () => {
  it('orders by votes desc, then proposedTime asc, then id asc', () => {
    expect(sortSchedulingSlots(TIE_SLOTS).map((s) => s.id)).toEqual(
      EXPECTED_ORDER,
    );
  });

  it('breaks a same-votes same-time pair by the lower id', () => {
    const a = { id: 1, proposedTime: LATE, voteCount: 3 };
    const b = { id: 9, proposedTime: LATE, voteCount: 3 };
    expect(compareSchedulingSlots(a, b)).toBeLessThan(0);
    expect(compareSchedulingSlots(b, a)).toBeGreaterThan(0);
  });

  it('accepts Date proposedTime as well as ISO strings', () => {
    const sorted = sortSchedulingSlots([
      { id: 2, proposedTime: new Date(LATE), voteCount: 1 },
      { id: 3, proposedTime: new Date(EARLY), voteCount: 1 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual([3, 2]);
  });

  it('renders the embed slot lines in the shared order', () => {
    const embed = buildSchedulingPollEmbedBody(pollData(), context);
    const description = embed.toJSON().description ?? '';
    const slotLines = description
      .split('\n')
      .filter((line) => line.startsWith('<t:'));
    // The embed caps its slot lines, so the tail of the order is truncated —
    // but the head must be the same head the web page and lock-in choose.
    expect(slotLines).toHaveLength(3);
    // id 8 — most votes.
    expect(slotLines[0]).toContain(unix(TOP));
    expect(slotLines[0]).toContain('**5** votes');
    // id 4 — tied on votes, earliest time.
    expect(slotLines[1]).toContain(unix(EARLY));
    expect(slotLines[1]).toContain('Bo, Cy');
    // id 1 beats id 9 on the id tie-break: same votes, same instant. Only
    // id 9 carries a voter name, so its absence pins which one rendered.
    expect(slotLines[2]).toContain(unix(LATE));
    expect(slotLines[2]).not.toContain('Ana');
  });

  it("lock-in's fallback picks the same tie winner the surfaces show first", () => {
    const line = schedulingPollAuthorLine(
      pollData({ status: 'locked_in', slots: TIE_SLOTS.slice(0, 3) }),
      'UTC',
    );
    // Top of the 3-way tie is id 4 (earliest time), NOT the first DB row.
    expect(line).toContain('Apr 10');
  });

  it('carries the slot id into the embed payload so the order is stable', () => {
    const built = buildEmbedSlots(
      [
        { id: 9, proposedTime: new Date(LATE) },
        { id: 4, proposedTime: new Date(EARLY) },
      ],
      [
        { slotId: 9, userId: 1, displayName: 'Ana' },
        { slotId: 4, userId: 2, displayName: 'Bo' },
      ] as never,
    );
    expect(built.map((s) => s.id)).toEqual([9, 4]);
    expect(sortSchedulingSlots(built).map((s) => s.id)).toEqual([4, 9]);
  });

  it('renders the voter names the payload already computed (F-15)', () => {
    const description =
      buildSchedulingPollEmbedBody(pollData(), context).toJSON().description ??
      '';
    expect(description).toContain('Dee');
    expect(description).toContain('Bo, Cy');
  });

  it('states the tie rule from the comparator when the top slots tie', () => {
    const description =
      buildSchedulingPollEmbedBody(
        pollData({ slots: TIE_SLOTS.slice(0, 3) }),
        context,
      ).toJSON().description ?? '';
    expect(description).toContain(SLOT_TIE_RULE);
    expect(SLOT_TIE_RULE).toMatch(/earliest time wins/i);
  });

  it('states no tie rule when one slot leads outright', () => {
    const description =
      buildSchedulingPollEmbedBody(pollData(), context).toJSON().description ??
      '';
    expect(description).not.toContain(SLOT_TIE_RULE);
  });
});
