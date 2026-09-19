/**
 * ROK-1617 — the WIRING proof.
 *
 * `noCount` is optional on the shared comparator, so a call site that forgets
 * to map it still compiles, still passes every pre-stance test, and silently
 * orders exactly as it did before — an anti-vote stored and ignored. Each case
 * below is built so it FAILS if its call site drops `noCount` (or counts a
 * `no` as a vote): the `no`-laden slot must lose to a slot the old arithmetic
 * would have ranked below it.
 */
import { findLeadingLockableSlot } from './scheduling-lock-in.helpers';
import { pickLeadingFutureSlot } from './scheduling-poll-expiry.helpers';
import { buildEmbedSlots } from './scheduling-poll-embed.helpers';
import { buildPollResponse } from './scheduling-response.helpers';
import { tallyStancesBySlot } from './scheduling-stance.helpers';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

/** N days from now, so every fixture slot is comfortably in the future. */
const inDays = (d: number): Date =>
  new Date(Date.now() + d * 24 * 60 * 60 * 1000);

/** A vote row carrying only what the ordering paths read. */
const vote = (slotId: number, stance: 'yes' | 'no') => ({ slotId, stance });

describe('tallyStancesBySlot', () => {
  it('splits mixed stances and defaults a missing stance to yes', () => {
    const tallies = tallyStancesBySlot([
      vote(1, 'yes'),
      vote(1, 'no'),
      { slotId: 1 },
      vote(2, 'no'),
    ]);
    expect(tallies.get(1)).toEqual({ voteCount: 2, noCount: 1 });
    expect(tallies.get(2)).toEqual({ voteCount: 0, noCount: 1 });
  });
});

describe('findLeadingLockableSlot — net score is wired', () => {
  const slots = [
    { id: 1, proposedTime: inDays(2) },
    { id: 2, proposedTime: inDays(3) },
  ];

  it('picks the lower-yes slot once anti-votes sink the other', () => {
    // Slot 1: 3 yes / 2 no → net 1. Slot 2: 2 yes / 0 no → net 2.
    // Counting rows (the un-wired behaviour) gives slot 1 five "votes" and it
    // wins; net score hands it to slot 2.
    const votes = [
      vote(1, 'yes'),
      vote(1, 'yes'),
      vote(1, 'yes'),
      vote(1, 'no'),
      vote(1, 'no'),
      vote(2, 'yes'),
      vote(2, 'yes'),
    ];
    expect(findLeadingLockableSlot(slots, votes)).toBe(2);
  });

  it('never offers a slot carrying only anti-votes', () => {
    expect(
      findLeadingLockableSlot(slots, [vote(1, 'no'), vote(1, 'no')]),
    ).toBeNull();
  });
});

describe('pickLeadingFutureSlot — net score is wired', () => {
  it('demotes a slot whose anti-votes cancel its support', () => {
    const slots = [
      { id: 1, proposedTime: inDays(2) },
      { id: 2, proposedTime: inDays(3) },
    ];
    const leader = pickLeadingFutureSlot(
      slots,
      [
        vote(1, 'yes'),
        vote(1, 'yes'),
        vote(1, 'yes'),
        vote(1, 'no'),
        vote(1, 'no'),
        vote(2, 'yes'),
        vote(2, 'yes'),
      ],
      new Date(),
    );
    expect(leader?.slotId).toBe(2);
    // The reported count is the YES side, not the row count.
    expect(leader?.voteCount).toBe(2);
  });
});

describe('buildPollResponse — the page splits stances (AC6 counts)', () => {
  const voteRow = (
    slotId: number,
    userId: number,
    stance: 'yes' | 'no',
  ): ScheduleVoteRow => ({
    id: userId * 10 + slotId,
    slotId,
    userId,
    stance,
    displayName: `U${userId}`,
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    createdAt: new Date(),
  });

  it('reports yes and no separately and keeps the no out of MY yes slots', () => {
    // The "N picked this time" counts and the web's per-slot state both read
    // these two fields; nothing else in the api suite pins them, so dropping
    // `noVotes` or mixing a `no` into `votes` would ship silently.
    const slots = [
      {
        id: 1,
        matchId: 5,
        proposedTime: inDays(2),
        overlapScore: null,
        suggestedBy: 'user',
        createdAt: new Date(),
      },
    ] as unknown as Parameters<typeof buildPollResponse>[2];
    const antiVoter = 12;

    const res = buildPollResponse(
      {
        id: 5,
        lineupId: 9,
        gameId: 7,
        status: 'scheduling',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Parameters<typeof buildPollResponse>[0],
      [],
      slots,
      [
        voteRow(1, 10, 'yes'),
        voteRow(1, 11, 'yes'),
        voteRow(1, antiVoter, 'no'),
      ],
      antiVoter,
      'decided',
      false,
    );

    expect(res.slots[0].votes.map((v) => v.userId)).toEqual([10, 11]);
    expect(res.slots[0].noVotes.map((v) => v.userId)).toEqual([antiVoter]);
    // The anti-voter answered, but NOT in favour of slot 1.
    expect(res.myVotedSlotIds).toEqual([]);
    expect(res.myNoSlotIds).toEqual([1]);
  });
});

describe('buildEmbedSlots — the card counts yes only', () => {
  const row = (
    slotId: number,
    userId: number,
    stance: 'yes' | 'no',
  ): ScheduleVoteRow => ({
    id: userId,
    slotId,
    userId,
    stance,
    displayName: `U${userId}`,
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    createdAt: new Date(),
  });

  it('splits counts and keeps anti-voters out of the voter names', () => {
    const slots = [
      {
        id: 1,
        matchId: 5,
        proposedTime: inDays(2),
        overlapScore: null,
        suggestedBy: 'user',
        createdAt: new Date(),
      },
    ] as unknown as Parameters<typeof buildEmbedSlots>[0];
    const [slot] = buildEmbedSlots(slots, [
      row(1, 10, 'yes'),
      row(1, 11, 'no'),
      row(1, 12, 'no'),
    ]);
    expect(slot.voteCount).toBe(1);
    expect(slot.noCount).toBe(2);
    expect(slot.voterNames).toEqual(['U10']);
  });
});
