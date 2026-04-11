/**
 * TDD tests for scheduling auto-signup + auto-heart helpers (ROK-1031).
 * Tests helper functions that DO NOT EXIST YET:
 *   - autoSignupSlotVoters() from ./scheduling-auto-signup.helpers
 *   - insertPollInterests() from ./scheduling-auto-heart.helpers
 *
 * These tests are expected to FAIL until the dev agent implements the helpers.
 */
import { autoSignupSlotVoters } from './scheduling-auto-signup.helpers';
import { insertPollInterests } from './scheduling-auto-heart.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { createMockUser } from '../../common/testing/factories';
import type { ScheduleVoteRow } from './scheduling-query.helpers';

// ─── Shared test data ──────────────────────────────────────────────────────

const CREATOR_ID = 1;
const EVENT_ID = 100;
const GAME_ID = 5;
const SLOT_ID = 20;

function buildVoterRow(overrides: Partial<ScheduleVoteRow>): ScheduleVoteRow {
  return {
    id: 1,
    slotId: SLOT_ID,
    userId: 10,
    displayName: 'Voter',
    avatar: null,
    discordId: '123456',
    customAvatarUrl: null,
    createdAt: new Date('2026-04-01T12:00:00Z'),
    ...overrides,
  };
}

function makeVoters(count: number): ScheduleVoteRow[] {
  return Array.from({ length: count }, (_, i) =>
    buildVoterRow({
      id: i + 1,
      userId: 10 + i,
      displayName: `Voter${i + 1}`,
      discordId: String(100 + i),
    }),
  );
}

// ─── autoSignupSlotVoters ──────────────────────────────────────────────────

describe('autoSignupSlotVoters', () => {
  let mockSignupsService: { signup: jest.Mock };

  beforeEach(() => {
    mockSignupsService = { signup: jest.fn().mockResolvedValue(undefined) };
  });

  it('signs up each voter who voted for the slot', async () => {
    const voters = makeVoters(3);

    await autoSignupSlotVoters({
      eventId: EVENT_ID,
      creatorId: CREATOR_ID,
      voters,
      signupsService: mockSignupsService,
    });

    expect(mockSignupsService.signup).toHaveBeenCalledTimes(3);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 10);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 11);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 12);
  });

  it('does not double-signup the event creator', async () => {
    // Creator (userId=1) is also a voter
    const voters = [
      buildVoterRow({ userId: CREATOR_ID, displayName: 'Creator' }),
      buildVoterRow({ id: 2, userId: 20, displayName: 'OtherVoter' }),
    ];

    await autoSignupSlotVoters({
      eventId: EVENT_ID,
      creatorId: CREATOR_ID,
      voters,
      signupsService: mockSignupsService,
    });

    // Creator should be excluded -- they are already signed up via event creation
    const calledUserIds = mockSignupsService.signup.mock.calls.map(
      (call: [number, number]) => call[1],
    );
    expect(calledUserIds).not.toContain(CREATOR_ID);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
    expect(mockSignupsService.signup).toHaveBeenCalledWith(EVENT_ID, 20);
  });

  it('handles empty voter list gracefully', async () => {
    await autoSignupSlotVoters({
      eventId: EVENT_ID,
      creatorId: CREATOR_ID,
      voters: [],
      signupsService: mockSignupsService,
    });

    expect(mockSignupsService.signup).not.toHaveBeenCalled();
  });

  it('continues signing up remaining voters when one signup fails', async () => {
    const voters = makeVoters(3);
    mockSignupsService.signup
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Duplicate signup'))
      .mockResolvedValueOnce(undefined);

    // Should not throw -- individual signup failures are swallowed
    await expect(
      autoSignupSlotVoters({
        eventId: EVENT_ID,
        creatorId: CREATOR_ID,
        voters,
        signupsService: mockSignupsService,
      }),
    ).resolves.not.toThrow();

    // All 3 voters should have been attempted
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(3);
  });

  it('deduplicates voters who appear in multiple slots', async () => {
    // Same userId appears twice (voted in two slots)
    const voters = [
      buildVoterRow({ id: 1, userId: 10, slotId: 20 }),
      buildVoterRow({ id: 2, userId: 10, slotId: 21 }),
      buildVoterRow({ id: 3, userId: 30, slotId: 20 }),
    ];

    await autoSignupSlotVoters({
      eventId: EVENT_ID,
      creatorId: CREATOR_ID,
      voters,
      signupsService: mockSignupsService,
    });

    // userId 10 should be signed up exactly once
    const calledUserIds = mockSignupsService.signup.mock.calls.map(
      (call: [number, number]) => call[1],
    );
    const user10Calls = calledUserIds.filter(
      (id: number) => id === 10,
    ).length;
    expect(user10Calls).toBe(1);
    expect(mockSignupsService.signup).toHaveBeenCalledTimes(2);
  });
});

// ─── insertPollInterests ───────────────────────────────────────────────────

describe('insertPollInterests', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('inserts game_interests rows with source "poll" for each voter', async () => {
    const voterUserIds = [10, 11, 12];

    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds,
    });

    // Should call insert with values containing source: 'poll'
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalled();

    const valuesCall = mockDb.values.mock.calls[0][0];
    expect(valuesCall).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 10,
          gameId: GAME_ID,
          source: 'poll',
        }),
        expect.objectContaining({
          userId: 11,
          gameId: GAME_ID,
          source: 'poll',
        }),
        expect.objectContaining({
          userId: 12,
          gameId: GAME_ID,
          source: 'poll',
        }),
      ]),
    );
  });

  it('uses onConflictDoNothing to avoid duplicating existing interests', async () => {
    const voterUserIds = [10];

    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds,
    });

    expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
  });

  it('skips suppressed (userId, gameId) pairs', async () => {
    // Mock: user 11 has a suppression row
    mockDb.where.mockResolvedValueOnce([{ userId: 11, gameId: GAME_ID }]);

    const voterUserIds = [10, 11, 12];

    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds,
    });

    // The values inserted should NOT include userId=11
    const valuesCall = mockDb.values.mock.calls[0][0] as Array<{
      userId: number;
    }>;
    const insertedUserIds = valuesCall.map(
      (v: { userId: number }) => v.userId,
    );
    expect(insertedUserIds).not.toContain(11);
    expect(insertedUserIds).toContain(10);
    expect(insertedUserIds).toContain(12);
  });

  it('does not insert anything when all voters are suppressed', async () => {
    // All voters suppressed
    mockDb.where.mockResolvedValueOnce([
      { userId: 10, gameId: GAME_ID },
      { userId: 11, gameId: GAME_ID },
    ]);

    const voterUserIds = [10, 11];

    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds,
    });

    // Should not attempt an insert at all (or insert empty)
    // The exact assertion depends on implementation -- either insert is
    // not called, or values is called with an empty array.
    const insertCalled = mockDb.insert.mock.calls.length > 0;
    if (insertCalled) {
      const valuesCall = mockDb.values.mock.calls[0]?.[0];
      expect(valuesCall).toEqual([]);
    } else {
      expect(mockDb.insert).not.toHaveBeenCalled();
    }
  });

  it('does not re-heart a game the user already has an interest for', async () => {
    // No suppressions but user 10 already has an interest
    // onConflictDoNothing handles this at the DB level
    mockDb.where.mockResolvedValueOnce([]);

    const voterUserIds = [10];

    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds,
    });

    // onConflictDoNothing ensures no duplicate; verify the call
    expect(mockDb.onConflictDoNothing).toHaveBeenCalled();
  });

  it('handles empty voter list gracefully', async () => {
    await insertPollInterests({
      db: mockDb as never,
      gameId: GAME_ID,
      voterUserIds: [],
    });

    // Should not attempt any DB operations for empty list
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
