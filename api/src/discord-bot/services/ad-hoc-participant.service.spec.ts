import { Test, TestingModule } from '@nestjs/testing';
import { AdHocParticipantService } from './ad-hoc-participant.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('AdHocParticipantService', () => {
  let service: AdHocParticipantService;
  let mockDb: MockDb;

  const baseMember = {
    discordUserId: 'discord-123',
    discordUsername: 'TestPlayer',
    discordAvatarHash: 'avatar-hash',
    userId: 1,
  };

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdHocParticipantService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get(AdHocParticipantService);
  });

  describe('addParticipant', () => {
    it('inserts a new participant with upsert on conflict', async () => {
      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      await service.addParticipant(42, baseMember);

      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          eventId: 42,
          discordUserId: 'discord-123',
          discordUsername: 'TestPlayer',
          discordAvatarHash: 'avatar-hash',
          userId: 1,
          sessionCount: 1,
        }),
      );
      expect(mockDb.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          set: expect.objectContaining({
            leftAt: null,
            discordUsername: 'TestPlayer',
            discordAvatarHash: 'avatar-hash',
            userId: 1,
          }),
        }),
      );
    });

    it('handles anonymous participant with null userId', async () => {
      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      const anonymousMember = { ...baseMember, userId: null };
      await service.addParticipant(42, anonymousMember);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          discordUserId: 'discord-123',
        }),
      );
    });

    it('handles member with null avatar hash', async () => {
      mockDb.onConflictDoUpdate.mockResolvedValueOnce(undefined);

      const noAvatarMember = { ...baseMember, discordAvatarHash: null };
      await service.addParticipant(42, noAvatarMember);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          discordAvatarHash: null,
        }),
      );
    });
  });

  describe('markLeave', () => {
    it('marks participant as left with computed duration', async () => {
      jest.useFakeTimers();

      const joinedAt = new Date('2026-02-10T18:00:00Z');
      const row = {
        id: 'uuid-1',
        eventId: 42,
        discordUserId: 'discord-123',
        joinedAt,
        leftAt: null,
        totalDurationSeconds: null,
      };

      // select().from().where(and(...)).limit(1) — terminal is limit
      mockDb.limit.mockResolvedValueOnce([row]);
      // update().set().where() — terminal is where, default returnThis is fine

      // Set system time 120 seconds after join
      jest.setSystemTime(new Date(joinedAt.getTime() + 120_000));

      await service.markLeave(42, 'discord-123');

      expect(mockDb.update).toHaveBeenCalled();
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          totalDurationSeconds: 120,
        }),
      );

      jest.useRealTimers();
    });

    it('returns early when participant row not found', async () => {
      mockDb.limit.mockResolvedValueOnce([]);

      await service.markLeave(42, 'discord-unknown');

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('does not double-mark if participant already left', async () => {
      const row = {
        id: 'uuid-1',
        eventId: 42,
        discordUserId: 'discord-123',
        joinedAt: new Date('2026-02-10T18:00:00Z'),
        leftAt: new Date('2026-02-10T18:05:00Z'),
        totalDurationSeconds: 300,
      };

      mockDb.limit.mockResolvedValueOnce([row]);

      await service.markLeave(42, 'discord-123');

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('accumulates total duration across sessions', async () => {
      jest.useFakeTimers();

      const joinedAt = new Date('2026-02-10T19:00:00Z');
      const row = {
        id: 'uuid-1',
        eventId: 42,
        discordUserId: 'discord-123',
        joinedAt,
        leftAt: null,
        totalDurationSeconds: 300, // 5 min from prior session
      };

      // select().from().where(and(...)).limit(1) — terminal is limit
      mockDb.limit.mockResolvedValueOnce([row]);
      // update().set().where() — default returnThis is fine

      // Set system time 60 seconds after join
      jest.setSystemTime(new Date(joinedAt.getTime() + 60_000));

      await service.markLeave(42, 'discord-123');

      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          totalDurationSeconds: 360, // 300 + 60
        }),
      );

      jest.useRealTimers();
    });
  });

  describe('getRoster', () => {
    it('returns roster with ISO string timestamps', async () => {
      const joinedAt = new Date('2026-02-10T18:00:00Z');
      const leftAt = new Date('2026-02-10T18:30:00Z');
      const rows = [
        {
          id: 'uuid-1',
          eventId: 42,
          userId: 1,
          discordUserId: 'discord-123',
          discordUsername: 'Player1',
          discordAvatarHash: 'abc',
          joinedAt,
          leftAt,
          totalDurationSeconds: 1800,
          sessionCount: 1,
        },
        {
          id: 'uuid-2',
          eventId: 42,
          userId: null,
          discordUserId: 'discord-456',
          discordUsername: 'AnonPlayer',
          discordAvatarHash: null,
          joinedAt,
          leftAt: null,
          totalDurationSeconds: null,
          sessionCount: 2,
        },
      ];

      mockDb.where.mockResolvedValueOnce(rows);

      const result = await service.getRoster(42);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'uuid-1',
        eventId: 42,
        userId: 1,
        joinedAt: joinedAt.toISOString(),
        leftAt: leftAt.toISOString(),
        totalDurationSeconds: 1800,
        sessionCount: 1,
      });
      expect(result[1]).toMatchObject({
        userId: null,
        leftAt: null,
        totalDurationSeconds: null,
        sessionCount: 2,
      });
    });

    it('returns empty array when no participants', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.getRoster(42);

      expect(result).toEqual([]);
    });
  });

  describe('finalizeAll', () => {
    it('marks all active participants as left in a single query', async () => {
      // Single update().set().where().returning() chain
      mockDb.returning.mockResolvedValueOnce([{ id: 'uuid-1' }, { id: 'uuid-2' }]);

      await service.finalizeAll(42);

      expect(mockDb.update).toHaveBeenCalledTimes(1);
      expect(mockDb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          leftAt: expect.any(Date),
        }),
      );
    });

    it('handles no active participants gracefully', async () => {
      mockDb.returning.mockResolvedValueOnce([]);

      await service.finalizeAll(42);

      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('getActiveCount', () => {
    it('returns count of active (not-left) participants', async () => {
      mockDb.where.mockResolvedValueOnce([{ count: 5 }]);

      const count = await service.getActiveCount(42);

      expect(count).toBe(5);
    });

    it('returns 0 when result is empty', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const count = await service.getActiveCount(42);

      expect(count).toBe(0);
    });
  });
});
