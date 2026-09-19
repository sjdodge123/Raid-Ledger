/**
 * ROK-1617 — an anti-vote must never be read as support.
 *
 * `community_lineup_schedule_votes` used to mean "a row is a YES", so every
 * consumer that still asks only "is there a row?" now treats a member who said
 * "that time does not work" as someone who asked for it. These are the three
 * highest-consequence consumers: the lock-in roster, the lock-in guard, and the
 * standalone poll's auto-signup/DM split.
 */
import { BadRequestException } from '@nestjs/common';
import { yesVotesOnly } from './scheduling-stance.helpers';
import { assertSlotHasVoters } from './scheduling-lock-in.helpers';
import { createLockedInEvent } from './scheduling-event.helpers';
import type { LockInEventDeps } from './scheduling-event.helpers';
import { autoSignupSlotVoters } from './scheduling-auto-signup.helpers';
import { fireAutoHeartForVoters } from './scheduling-auto-heart.helpers';
import { findScheduleVotes } from './scheduling-query.helpers';
import type { ScheduleVoteRow } from './scheduling-query.helpers';
import { splitYesVotersBySlot } from '../standalone-poll/standalone-poll-voter.helpers';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./scheduling-query.helpers');
jest.mock('./scheduling-auto-signup.helpers');
jest.mock('./scheduling-auto-heart.helpers');
jest.mock('../lineups-notify-hooks.helpers');

const mockFindVotes = findScheduleVotes as jest.MockedFunction<
  typeof findScheduleVotes
>;
const mockAutoSignup = autoSignupSlotVoters as jest.MockedFunction<
  typeof autoSignupSlotVoters
>;
const mockAutoHeart = fireAutoHeartForVoters as jest.MockedFunction<
  typeof fireAutoHeartForVoters
>;

/** A vote row carrying only the fields these paths read. */
const row = (
  userId: number,
  stance: 'yes' | 'no',
  slotId = 1,
): ScheduleVoteRow => ({
  id: userId,
  slotId,
  userId,
  stance,
  displayName: `U${userId}`,
  avatar: null,
  discordId: String(userId),
  customAvatarUrl: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
});

beforeEach(() => jest.clearAllMocks());

describe('yesVotesOnly', () => {
  it('keeps yes rows and drops no rows', () => {
    const votes = [row(10, 'yes'), row(11, 'no'), row(12, 'yes')];
    expect(yesVotesOnly(votes).map((v) => v.userId)).toEqual([10, 12]);
  });

  it('treats a missing stance as yes (every pre-1617 row)', () => {
    expect(yesVotesOnly([{ userId: 1 }, { stance: null }])).toHaveLength(2);
  });
});

describe('assertSlotHasVoters — anti-votes are not voters (BLOCKER-3)', () => {
  it('refuses a slot whose only rows are anti-votes', async () => {
    mockFindVotes.mockResolvedValue([row(10, 'no'), row(11, 'no')]);
    await expect(
      assertSlotHasVoters(createDrizzleMock() as never, 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still allows a slot with at least one yes among the nos', async () => {
    mockFindVotes.mockResolvedValue([row(10, 'no'), row(11, 'yes')]);
    await expect(
      assertSlotHasVoters(createDrizzleMock() as never, 1),
    ).resolves.toBeUndefined();
  });
});

describe('createLockedInEvent — the roster is yes-voters only (BLOCKER-1)', () => {
  function buildDeps(): LockInEventDeps {
    const db = createDrizzleMock();
    db.limit.mockResolvedValue([]);
    return {
      db: db as unknown as LockInEventDeps['db'],
      eventsService: { create: jest.fn().mockResolvedValue({ id: 55 }) },
      signupsService: { signup: jest.fn() },
      lineupNotifications: {} as LockInEventDeps['lineupNotifications'],
      pollEmbed: { fireUpdateEmbed: jest.fn() },
      logger: {
        log: jest.fn(),
        error: jest.fn(),
      } as unknown as LockInEventDeps['logger'],
    };
  }

  it('never signs up or auto-hearts a member who rejected the locked-in time', async () => {
    mockFindVotes.mockResolvedValue([
      row(10, 'yes'),
      row(11, 'no'),
      row(12, 'yes'),
    ]);

    await createLockedInEvent(
      buildDeps(),
      { id: 3, gameId: 7 },
      { id: 1, proposedTime: new Date('2026-10-01T20:00:00.000Z') },
      10,
      false,
    );

    const signedUp = mockAutoSignup.mock.calls[0][0].voters;
    expect(signedUp.map((v) => v.userId)).toEqual([10, 12]);
    const hearted = mockAutoHeart.mock.calls[0][2];
    expect(hearted.map((v) => v.userId)).toEqual([10, 12]);
  });
});

describe('splitYesVotersBySlot — the standalone poll split (BLOCKER-2)', () => {
  const slots = [
    { id: 1, proposedTime: new Date('2026-10-01T20:00:00.000Z') },
    { id: 2, proposedTime: new Date('2026-10-02T20:00:00.000Z') },
  ];

  it('keeps an anti-voter out of BOTH the signup list and the other-time DM', () => {
    const { selectedVoters, otherVoters } = splitYesVotersBySlot(
      slots,
      [
        row(10, 'yes', 1),
        row(11, 'no', 1),
        row(12, 'no', 2),
        row(13, 'yes', 2),
      ],
      '2026-10-01T20:00:00.000Z',
    );
    expect(selectedVoters.map((v) => v.userId)).toEqual([10]);
    expect(otherVoters.map((v) => v.userId)).toEqual([13]);
  });
});
