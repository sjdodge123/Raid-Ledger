import { Test, TestingModule } from '@nestjs/testing';
import type { ItemTooltip } from '@raid-ledger/contract';
import {
  BossEncountersService,
  bossLootCacheKey,
} from './boss-encounters.service';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';

let service: BossEncountersService;
let mockSeeder: { seed: jest.Mock; drop: jest.Mock };
let mockDb: { select: jest.Mock };
let mockOrderBy: jest.Mock;
let mockLeftJoin: jest.Mock;
let mockInnerJoin: jest.Mock;
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

  // Fluent Drizzle mock:
  // db.select().from()[.innerJoin()][.leftJoin()].where().orderBy()
  mockOrderBy = jest.fn().mockResolvedValue([]);
  const mockWhere = jest.fn().mockReturnValue({ orderBy: mockOrderBy });
  mockLeftJoin = jest.fn().mockReturnValue({ where: mockWhere });
  mockInnerJoin = jest
    .fn()
    .mockReturnValue({ where: mockWhere, leftJoin: mockLeftJoin });
  const mockFrom = jest.fn().mockReturnValue({
    where: mockWhere,
    leftJoin: mockLeftJoin,
    innerJoin: mockInnerJoin,
  });

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

    it('should return classic + forever for wow_forever (ROK-1719)', () => {
      expect(service.getExpansionsForVariant('wow_forever')).toEqual([
        'classic',
        'forever',
      ]);
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

    // ROK-2270: a versioned key, so pre-fallback cached `[]` is never read.
    it('reads the loot cache through the versioned key builder', async () => {
      await service.getLootForBoss(7, 'wow_forever');
      expect(bossLootCacheKey(7, 'wow_forever')).toBe(
        'wow:bosses:loot:v2:7:wow_forever',
      );
      expect(mockRedis.get).toHaveBeenCalledWith(
        'wow:bosses:loot:v2:7:wow_forever',
      );
    });
  });
});

/**
 * A stored loot row as the read returns it (ROK-2170), with its boss's
 * instance (ROK-2209; 63 = Deadmines, a Forever catalogue dungeon).
 */
function lootRow(id: number, expansion: string, instanceId = 63) {
  return {
    id,
    bossId: 7,
    instanceId,
    itemId: 1000 + id,
    itemName: `Item ${id}`,
    slot: null,
    quality: 'Rare',
    itemLevel: null,
    dropRate: null,
    expansion,
    classRestrictions: null,
    iconUrl: null,
    itemSubclass: null,
  };
}

describe('BossEncountersService — Forever loot read rule (ROK-2170)', () => {
  beforeEach(() => setupEach());

  it('returns only the forever rows under wow_forever when the boss has any', async () => {
    mockOrderBy.mockResolvedValue([
      lootRow(1, 'classic'),
      lootRow(2, 'forever'),
    ]);
    const result = await service.getLootForBoss(7, 'wow_forever');
    expect(result.map((l) => [l.id, l.expansion])).toEqual([[2, 'forever']]);
  });

  // ROK-2270 (operator ruling 2026-11-20, partially reversing ROK-2209's
  // "returns []"): a boss with no forever rows on an instance with a Classic
  // edition reads its classic rows, each still `expansion: 'classic'` so the
  // web can label them.
  it('falls back to the classic rows under wow_forever when the boss has no forever rows', async () => {
    mockOrderBy.mockResolvedValue([
      lootRow(1, 'classic'),
      lootRow(3, 'classic'),
    ]);
    const result = await service.getLootForBoss(7, 'wow_forever');
    expect(result.map((l) => [l.id, l.expansion])).toEqual([
      [1, 'classic'],
      [3, 'classic'],
    ]);
  });

  it('returns [] under wow_forever for a Forever-new dungeon (no Classic edition)', async () => {
    mockOrderBy.mockResolvedValue([lootRow(1, 'classic', 90_000_002)]);
    const result = await service.getLootForBoss(7, 'wow_forever');
    expect(result).toEqual([]);
  });

  it('returns [] under wow_forever for an instance the catalogue does not know', async () => {
    mockOrderBy.mockResolvedValue([lootRow(1, 'classic', 999999)]);
    const result = await service.getLootForBoss(7, 'wow_forever');
    expect(result).toEqual([]);
  });

  it('reads the boss instance by joining the boss row', async () => {
    await service.getLootForBoss(7, 'wow_forever');
    expect(mockInnerJoin).toHaveBeenCalledTimes(1);
  });

  it('never returns forever rows under classic_era', async () => {
    mockOrderBy.mockResolvedValue([
      lootRow(1, 'classic'),
      lootRow(2, 'forever'),
    ]);
    const result = await service.getLootForBoss(7, 'classic_era');
    expect(result.map((l) => [l.id, l.expansion])).toEqual([[1, 'classic']]);
    expect(service.getExpansionsForVariant('classic_era')).not.toContain(
      'forever',
    );
  });

  it('keeps a journal variant to its expansion set (classic_anniversary)', async () => {
    mockOrderBy.mockResolvedValue([
      lootRow(1, 'classic'),
      lootRow(2, 'tbc'),
      lootRow(3, 'forever'),
      lootRow(4, 'wotlk'),
    ]);
    const result = await service.getLootForBoss(7, 'classic_anniversary');
    expect(result.map((l) => l.id)).toEqual([1, 2]);
  });

  // ROK-2270: only wow_forever falls back, and only to classic.
  it('never falls back under a TBC-era variant with none of its own rows', async () => {
    mockOrderBy.mockResolvedValue([lootRow(1, 'forever'), lootRow(2, 'wotlk')]);
    const result = await service.getLootForBoss(7, 'classic_anniversary');
    expect(result).toEqual([]);
  });

  it('falls back to classic rows only, never tbc, under wow_forever', async () => {
    mockOrderBy.mockResolvedValue([lootRow(1, 'classic'), lootRow(2, 'tbc')]);
    const result = await service.getLootForBoss(7, 'wow_forever');
    expect(result.map((l) => [l.id, l.expansion])).toEqual([[1, 'classic']]);
  });
});

describe('BossEncountersService — stored loot tooltip (ROK-2176)', () => {
  beforeEach(() => setupEach());

  const TOOLTIP: ItemTooltip = {
    env: 16,
    slotLabel: 'Two-Hand',
    subclass: 'Mace',
    binding: 'Binds when picked up',
    unique: false,
    requiredLevel: 60,
    armor: null,
    weapon: null,
    stats: [{ key: 'STRENGTH', name: 'Strength', value: 12, unit: 'flat' }],
    effects: [],
    setName: null,
    randomEnchant: false,
  };

  it('left-joins the Wowhead item cache on the loot read', async () => {
    await service.getLootForBoss(7, 'classic_era');
    expect(mockLeftJoin).toHaveBeenCalledTimes(1);
  });

  it('passes a stored tooltip through onto the loot row', async () => {
    mockOrderBy.mockResolvedValue([
      { ...lootRow(1, 'classic'), tooltip: TOOLTIP },
    ]);
    const [loot] = await service.getLootForBoss(7, 'classic_era');
    expect(loot?.tooltip).toEqual(TOOLTIP);
  });

  it('sets tooltip to null when the item has no cached tooltip', async () => {
    mockOrderBy.mockResolvedValue([
      { ...lootRow(1, 'classic'), tooltip: null },
      lootRow(2, 'classic'),
    ]);
    const result = await service.getLootForBoss(7, 'classic_era');
    expect(result.map((l) => l.tooltip)).toEqual([null, null]);
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
