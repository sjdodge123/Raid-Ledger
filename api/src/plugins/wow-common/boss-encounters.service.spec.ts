import { Test, TestingModule } from '@nestjs/testing';
import { BossEncountersService } from './boss-encounters.service';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';

let service: BossEncountersService;
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
    seed: jest.fn().mockResolvedValue({ bossesInserted: 10, lootInserted: 20 }),
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
      BossEncountersService,
      { provide: BossEncounterSeeder, useValue: mockSeeder },
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: REDIS_CLIENT, useValue: mockRedis },
    ],
  }).compile();

  service = module.get<BossEncountersService>(BossEncountersService);
}

describe('BossEncountersService — variant and queries', () => {
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

  describe('getBossesForInstance()', () => {
    it('should query the database with correct instance ID', async () => {
      await service.getBossesForInstance(409, 'classic_era');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return an empty array when no bosses found', async () => {
      const result = await service.getBossesForInstance(999, 'classic_era');
      expect(result).toEqual([]);
    });
  });

  describe('getLootForBoss()', () => {
    it('should query the database with correct boss ID', async () => {
      await service.getLootForBoss(1, 'classic_era');
      expect(mockDb.select).toHaveBeenCalled();
    });

    it('should return an empty array when no loot found', async () => {
      const result = await service.getLootForBoss(999, 'classic_era');
      expect(result).toEqual([]);
    });
  });
});

describe('BossEncountersService — seeder and cache', () => {
  beforeEach(() => setupEach());

  describe('seedBosses()', () => {
    it('should delegate to seeder and clear cache', async () => {
      const result = await service.seedBosses();
      expect(mockSeeder.seed).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:bosses:*');
      expect(result).toEqual({ bossesInserted: 10, lootInserted: 20 });
    });
  });

  describe('dropBosses()', () => {
    it('should delegate to seeder and clear cache', async () => {
      await service.dropBosses();
      expect(mockSeeder.drop).toHaveBeenCalled();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:bosses:*');
    });
  });

  describe('clearCache()', () => {
    it('should delete matching Redis keys', async () => {
      mockRedis.keys.mockResolvedValue([
        'wow:bosses:instance:409:classic_era',
        'wow:bosses:loot:1:classic_era',
      ]);
      await service.clearCache();
      expect(mockRedis.keys).toHaveBeenCalledWith('wow:bosses:*');
      expect(mockRedis.del).toHaveBeenCalledWith(
        'wow:bosses:instance:409:classic_era',
        'wow:bosses:loot:1:classic_era',
      );
    });

    it('should not call del when no keys exist', async () => {
      mockRedis.keys.mockResolvedValue([]);
      await service.clearCache();
      expect(mockRedis.del).not.toHaveBeenCalled();
    });
  });
});
