import { Test, TestingModule } from '@nestjs/testing';
import { QuestProgressService } from './quest-progress.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

describe('QuestProgressService', () => {
  let service: QuestProgressService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestProgressService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get<QuestProgressService>(QuestProgressService);
  });

  describe('getProgressForEvent()', () => {
    it('should return progress entries for an event', async () => {
      const mockProgress = [
        {
          id: 1,
          eventId: 10,
          userId: 1,
          username: 'Roknua',
          questId: 2040,
          pickedUp: true,
          completed: false,
        },
      ];
      mockDb.where.mockResolvedValueOnce(mockProgress);

      const result = await service.getProgressForEvent(10);

      expect(result).toEqual(mockProgress);
    });

    it('should return empty array when no progress entries exist', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.getProgressForEvent(999);

      expect(result).toEqual([]);
    });
  });

  describe('updateProgress()', () => {
    it('should insert new progress entry when none exists', async () => {
      // First query: check existing — returns empty
      mockDb.limit.mockResolvedValueOnce([]);

      // Insert + returning
      const insertedRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        questId: 2040,
        pickedUp: true,
        completed: false,
      };
      mockDb.returning.mockResolvedValueOnce([insertedRow]);

      // Username lookup
      mockDb.limit.mockResolvedValueOnce([{ username: 'Roknua' }]);

      const result = await service.updateProgress(10, 1, 2040, {
        pickedUp: true,
      });

      expect(result).toEqual({
        id: 1,
        eventId: 10,
        userId: 1,
        username: 'Roknua',
        questId: 2040,
        pickedUp: true,
        completed: false,
      });
    });

    it('should update existing progress entry', async () => {
      // First query: check existing — returns row
      mockDb.limit.mockResolvedValueOnce([
        {
          id: 1,
          eventId: 10,
          userId: 1,
          questId: 2040,
          pickedUp: false,
          completed: false,
        },
      ]);

      // Update + returning
      const updatedRow = {
        id: 1,
        eventId: 10,
        userId: 1,
        questId: 2040,
        pickedUp: true,
        completed: false,
      };
      mockDb.returning.mockResolvedValueOnce([updatedRow]);

      // Username lookup
      mockDb.limit.mockResolvedValueOnce([{ username: 'Roknua' }]);

      const result = await service.updateProgress(10, 1, 2040, {
        pickedUp: true,
      });

      expect(result.pickedUp).toBe(true);
    });
  });

  describe('getCoverageForEvent()', () => {
    it('should return coverage grouped by questId', async () => {
      const mockRows = [
        { questId: 2040, userId: 1, username: 'Roknua', pickedUp: true },
        { questId: 2040, userId: 2, username: 'AltChar', pickedUp: true },
        { questId: 3001, userId: 1, username: 'Roknua', pickedUp: true },
      ];
      mockDb.where.mockResolvedValueOnce(mockRows);

      const result = await service.getCoverageForEvent(10);

      expect(result).toHaveLength(2);

      const quest2040 = result.find((e) => e.questId === 2040);
      expect(quest2040?.coveredBy).toHaveLength(2);

      const quest3001 = result.find((e) => e.questId === 3001);
      expect(quest3001?.coveredBy).toHaveLength(1);
    });

    it('should return empty array when no one has picked up quests', async () => {
      mockDb.where.mockResolvedValueOnce([]);

      const result = await service.getCoverageForEvent(10);

      expect(result).toEqual([]);
    });
  });
});
