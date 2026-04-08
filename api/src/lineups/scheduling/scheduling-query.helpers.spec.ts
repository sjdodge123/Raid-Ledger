/**
 * Unit tests for scheduling query helpers (ROK-965).
 * Uses flat drizzle-mock to verify query builder invocations.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import {
  deleteAllUserVotesForMatch,
  findScheduleSlots,
  findScheduleVotes,
  insertScheduleSlot,
  insertScheduleVote,
  deleteScheduleVote,
  findVoteBySlotAndUser,
  updateMatchLinkedEvent,
} from './scheduling-query.helpers';

describe('scheduling-query.helpers', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  describe('deleteAllUserVotesForMatch', () => {
    it('calls delete with where clause', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await deleteAllUserVotesForMatch(mockDb as never, 10, 42);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('completes without error for valid inputs', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const result = await deleteAllUserVotesForMatch(mockDb as never, 10, 42);

      // The function resolves (no throw), result is the resolved where()
      expect(result).toBeDefined();
    });
  });

  describe('findScheduleSlots', () => {
    it('calls select/from/where chain for match slots', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, matchId: 10, proposedTime: new Date() },
      ]);

      const result = await findScheduleSlots(mockDb as never, 10);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.from).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });
  });

  describe('findScheduleVotes', () => {
    it('returns empty array for empty slotIds', async () => {
      const result = await findScheduleVotes(mockDb as never, []);

      expect(result).toEqual([]);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('queries votes with join for non-empty slotIds', async () => {
      mockDb.where.mockResolvedValueOnce([
        { id: 1, slotId: 20, userId: 100, displayName: 'Alice' },
      ]);

      const result = await findScheduleVotes(mockDb as never, [20]);

      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.innerJoin).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    // ROK-1014: findScheduleVotes must include avatar fields from users table
    it('returns avatar, discordId, and customAvatarUrl fields (ROK-1014)', async () => {
      mockDb.where.mockResolvedValueOnce([
        {
          id: 1,
          slotId: 20,
          userId: 100,
          displayName: 'Alice',
          avatar: 'abc123hash',
          discordId: '123456789',
          customAvatarUrl: 'https://example.com/avatar.png',
          createdAt: new Date(),
        },
      ]);

      const result = await findScheduleVotes(mockDb as never, [20]);

      // The select() call must include avatar, discordId, customAvatarUrl fields
      // from the users table. Verify the select arg contains these field selectors.
      const selectArg = mockDb.select.mock.calls[0][0] as Record<string, unknown>;
      expect(selectArg).toHaveProperty('avatar');
      expect(selectArg).toHaveProperty('discordId');
      expect(selectArg).toHaveProperty('customAvatarUrl');
    });
  });

  describe('insertScheduleSlot', () => {
    it('inserts a slot and returns via returning()', async () => {
      mockDb.returning.mockResolvedValueOnce([{ id: 42 }]);

      const result = await insertScheduleSlot(
        mockDb as never,
        10,
        new Date(),
        'user',
      );

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
      expect(result).toEqual([{ id: 42 }]);
    });
  });

  describe('insertScheduleVote', () => {
    it('inserts a vote and returns via returning()', async () => {
      mockDb.returning.mockResolvedValueOnce([
        { id: 1, slotId: 20, userId: 100 },
      ]);

      const result = await insertScheduleVote(mockDb as never, 20, 100);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, slotId: 20, userId: 100 }]);
    });
  });

  describe('deleteScheduleVote', () => {
    it('calls delete with where clause', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await deleteScheduleVote(mockDb as never, 20, 100);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });

  describe('findVoteBySlotAndUser', () => {
    it('returns matching vote record', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 5 }]);

      const result = await findVoteBySlotAndUser(mockDb as never, 20, 100);

      expect(mockDb.select).toHaveBeenCalled();
      expect(result).toEqual([{ id: 5 }]);
    });

    it('returns empty array when no vote exists', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      const result = await findVoteBySlotAndUser(mockDb as never, 20, 100);

      expect(result).toEqual([]);
    });
  });

  describe('updateMatchLinkedEvent', () => {
    it('calls update/set/where to link event to match', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      await updateMatchLinkedEvent(mockDb as never, 10, 200);

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });
  });
});
