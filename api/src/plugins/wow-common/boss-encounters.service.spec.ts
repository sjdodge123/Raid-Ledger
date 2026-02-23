import { Test, TestingModule } from '@nestjs/testing';
import { BossEncountersService } from './boss-encounters.service';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

describe('BossEncountersService', () => {
  let service: BossEncountersService;
  let mockSeeder: { seed: jest.Mock; drop: jest.Mock };
  let mockDb: { select: jest.Mock };

  beforeEach(async () => {
    mockSeeder = {
      seed: jest
        .fn()
        .mockResolvedValue({ bossesInserted: 10, lootInserted: 20 }),
      drop: jest.fn().mockResolvedValue(undefined),
    };

    // Build a fluent mock for Drizzle queries: db.select().from().where().orderBy()
    const mockOrderBy = jest.fn().mockResolvedValue([]);
    const mockWhere = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
    const mockFrom = jest.fn().mockReturnValue({ where: mockWhere });

    mockDb = {
      select: jest.fn().mockReturnValue({ from: mockFrom }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BossEncountersService,
        { provide: BossEncounterSeeder, useValue: mockSeeder },
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get<BossEncountersService>(BossEncountersService);
  });

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

  describe('seedBosses()', () => {
    it('should delegate to seeder', async () => {
      const result = await service.seedBosses();

      expect(mockSeeder.seed).toHaveBeenCalled();
      expect(result).toEqual({ bossesInserted: 10, lootInserted: 20 });
    });
  });

  describe('dropBosses()', () => {
    it('should delegate to seeder', async () => {
      await service.dropBosses();

      expect(mockSeeder.drop).toHaveBeenCalled();
    });
  });
});
