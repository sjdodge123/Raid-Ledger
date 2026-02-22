import { Test, TestingModule } from '@nestjs/testing';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('DungeonQuestSeeder', () => {
  let seeder: DungeonQuestSeeder;
  let mockDb: {
    insert: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
    const mockOnConflictDoNothing = jest
      .fn()
      .mockReturnValue({ returning: mockReturning });
    const mockValues = jest
      .fn()
      .mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });

    mockDb = {
      insert: jest.fn().mockReturnValue({ values: mockValues }),
      delete: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DungeonQuestSeeder,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    seeder = module.get<DungeonQuestSeeder>(DungeonQuestSeeder);
  });

  describe('seed()', () => {
    it('should insert dungeon quests from bundled data', async () => {
      const result = await seeder.seed();

      expect(result).toHaveProperty('inserted');
      expect(result).toHaveProperty('total');
      expect(result.total).toBeGreaterThan(0);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should return total matching the bundled data count', async () => {
      const result = await seeder.seed();

      // The bundled data should have a reasonable number of quests
      expect(result.total).toBeGreaterThanOrEqual(100);
    });
  });

  describe('drop()', () => {
    it('should delete all dungeon quest data', async () => {
      await seeder.drop();

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
