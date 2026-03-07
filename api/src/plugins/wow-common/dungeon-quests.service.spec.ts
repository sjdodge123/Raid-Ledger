import { Test, TestingModule } from '@nestjs/testing';
import { DungeonQuestsService } from './dungeon-quests.service';
import { DungeonQuestSeeder } from './dungeon-quest-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';

let service: DungeonQuestsService;
let mockSeeder: { seed: jest.Mock; drop: jest.Mock };
let mockDb: { select: jest.Mock };
let mockRedis: {
  get: jest.Mock;
  setex: jest.Mock;
  keys: jest.Mock;
  del: jest.Mock;
};

async function setupEach() {
  mockSeeder = {
    seed: jest.fn().mockResolvedValue({ inserted: 10, total: 10 }),
    drop: jest.fn().mockResolvedValue(undefined),
  };

  // Build a fluent mock for Drizzle queries: db.select().from().where().orderBy()
  const mockOrderBy = jest.fn().mockResolvedValue([]);
  const mockWhere = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });

  mockDb = {
    select: jest.fn().mockReturnValue({ from: mockFrom }),
  };

  mockRedis = {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
    keys: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(0),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DungeonQuestsService,
      { provide: DungeonQuestSeeder, useValue: mockSeeder },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();

  service = module.get<DungeonQuestsService>(DungeonQuestsService);
}

describe('DungeonQuestsService — variant and queries', () => {
  beforeEach(() => setupEach());

  describe('getExpansionsForVariant()', () => {
    it('should return classic only for classic_era', () => {
      expect(service.getExpansionsForVariant('classic_era')).toEqual([
        'classic',
      ]);
    });

    it('should return classic+tbc for classic_anniversary', () => {
      expect(service.getExpansionsForVariant('classic_anniversary')).toEqual([
        'classic',
        'tbc',
      ]);
    });

    it('should return all expansions for classic (Cata)', () => {
      expect(service.getExpansionsForVariant('classic')).toEqual([
        'classic',
        'tbc',
        'wotlk',
        'cata',
      ]);
    });

    it('should default to classic_era for unknown variant', () => {
      expect(service.getExpansionsForVariant('unknown')).toEqual(['classic']);
    });
  });

  describe('getQuestsForInstance()', () => {
    it('should query the database with correct instance ID', async () => {
      await service.getQuestsForInstance(228, 'classic_era');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return an empty array when no quests found', async () => {
      const result = await service.getQuestsForInstance(999, 'classic_era');
      expect(result).toEqual([]);
    });
  });
});

describe('DungeonQuestsService — seeder and cache', () => {
  beforeEach(() => setupEach());

  describe('seedQuests()', () => {
    it('should delegate to seeder and clear cache', async () => {
      const result = await service.seedQuests();
      expect(mockSeeder.seed).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:quests:*');
      expect(result).toEqual({ inserted: 10, total: 10 });
    });
  });

  describe('dropQuests & clearCache', () => {
    it('should delegate to seeder and clear cache', async () => {
      await service.dropQuests();
      expect(mockSeeder.drop).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:quests:*');
    });

    it('should delete matching Redis keys', async () => {
      mockRedis.keys.mockResolvedValue(['wow:quests:enriched:228:classic_era']);
      await service.clearCache();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:quests:*');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'wow:quests:enriched:228:classic_era',
      );
    });

    it('should not call del when no keys exist', async () => {
      mockRedis.keys.mockResolvedValue([]);
      await service.clearCache();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
