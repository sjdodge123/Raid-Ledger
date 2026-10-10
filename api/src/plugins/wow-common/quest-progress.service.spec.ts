import { Test, TestingModule } from '@nestjs/testing';
import { QuestProgressService } from './quest-progress.service';
import { QuestProgressReadService } from './quest-progress-read.service';
import { loadForeverMemberProgress } from './event-forever-progress.query';
import type { ForeverEventProgress } from './event-forever-progress.helpers';

jest.mock('./event-forever-progress.query');
const mockLoad = jest.mocked(loadForeverMemberProgress);
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';

let service: QuestProgressService;
let mockDb: MockDb;
const mockReads = { invalidateCoverage: jest.fn() };

async function setupEach() {
  mockDb = createDrizzleMock();
  mockLoad.mockReset().mockResolvedValue(null);

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      QuestProgressService,
      { provide: QuestProgressReadService, useValue: mockReads },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  service = module.get<QuestProgressService>(QuestProgressService);
}

async function testInsertNewProgress() {
  mockDb.limit.mockResolvedValueOnce([]);

  const insertedRow = {
    id: 1,
    eventId: 10,
    userId: 1,
    questId: 2040,
    pickedUp: true,
    completed: false,
  };
  mockDb.returning.mockResolvedValueOnce([insertedRow]);
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
}

async function testUpdateExistingProgress() {
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

  const updatedRow = {
    id: 1,
    eventId: 10,
    userId: 1,
    questId: 2040,
    pickedUp: true,
    completed: false,
  };
  mockDb.returning.mockResolvedValueOnce([updatedRow]);
  mockDb.limit.mockResolvedValueOnce([{ username: 'Roknua' }]);

  const result = await service.updateProgress(10, 1, 2040, {
    pickedUp: true,
  });

  expect(result.pickedUp).toBe(true);
}

describe('QuestProgressService — write', () => {
  beforeEach(() => setupEach());

  describe('updateProgress()', () => {
    it('should insert new progress entry when none exists', () =>
      testInsertNewProgress());

    it('should update existing progress entry', () =>
      testUpdateExistingProgress());

    it('D5: insert fills the unspecified field from the addon row', async () => {
      mockLoad.mockResolvedValue(foreverWithCompleted(2040));
      mockDb.limit.mockResolvedValueOnce([]);
      mockDb.returning.mockResolvedValueOnce([
        {
          id: 2,
          eventId: 10,
          userId: 1,
          questId: 2040,
          pickedUp: true,
          completed: true,
        },
      ]);
      mockDb.limit.mockResolvedValueOnce([{ username: 'Roknua' }]);
      await service.updateProgress(10, 1, 2040, { pickedUp: true });
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ pickedUp: true, completed: true }),
      );
      expect(mockLoad).toHaveBeenCalledWith(mockDb, 10, 1);
      expect(mockReads.invalidateCoverage).toHaveBeenCalledWith(10);
    });

    it('Classic insert still defaults unspecified fields to false', async () => {
      await testInsertNewProgress();
      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({ pickedUp: true, completed: false }),
      );
    });
  });
});

/** A Forever context where user 1's character has completed `questId`. */
function foreverWithCompleted(questId: number): ForeverEventProgress {
  return {
    eventQuests: [],
    lookup: new Map(),
    knownIds: new Set([questId]),
    members: [
      {
        userId: 1,
        username: 'Roknua',
        characterId: 'char-1',
        snapshot: {
          quests: { completed: [questId], inProgress: [] },
          capturedAt: '2026-10-01T00:00:00.000Z',
        },
      },
    ],
  };
}
