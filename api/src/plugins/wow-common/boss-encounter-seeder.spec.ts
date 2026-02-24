import { Test, TestingModule } from '@nestjs/testing';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

// Mock fs/promises so the test never reads real data files (avoids CI worker OOM)
const fakeBosses = [
  {
    instanceId: 409,
    name: 'Ragnaros',
    order: 1,
    expansion: 'classic',
    sodModified: false,
  },
  {
    instanceId: 409,
    name: 'Lucifron',
    order: 2,
    expansion: 'classic',
    sodModified: false,
  },
];

const fakeLoot = [
  {
    bossName: 'Ragnaros',
    expansion: 'classic',
    itemId: 17182,
    itemName: 'Sulfuras, Hand of Ragnaros',
    slot: 'Two-Hand',
    quality: 'Legendary',
    itemLevel: 80,
    dropRate: 1.2,
    classRestrictions: null,
    iconUrl: null,
    itemSubclass: 'Mace',
  },
];

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockImplementation((path: string) => {
    if (path.includes('boss-encounter-data'))
      return Promise.resolve(JSON.stringify(fakeBosses));
    if (path.includes('boss-loot-data'))
      return Promise.resolve(JSON.stringify(fakeLoot));
    return Promise.reject(new Error(`Unexpected readFile: ${path}`));
  }),
}));

describe('BossEncounterSeeder', () => {
  let seeder: BossEncounterSeeder;
  let mockDb: {
    insert: jest.Mock;
    delete: jest.Mock;
    select: jest.Mock;
  };

  beforeEach(async () => {
    const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
    const mockOnConflictDoUpdate = jest
      .fn()
      .mockReturnValue({ returning: mockReturning });
    const mockValues = jest
      .fn()
      .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });

    // Mock for select().from() — returns boss rows for loot FK resolution
    const mockFrom = jest.fn().mockResolvedValue([
      { id: 1, name: 'Ragnaros', expansion: 'classic' },
      { id: 2, name: 'Lucifron', expansion: 'classic' },
    ]);

    mockDb = {
      insert: jest.fn().mockReturnValue({ values: mockValues }),
      delete: jest.fn().mockResolvedValue(undefined),
      select: jest.fn().mockReturnValue({ from: mockFrom }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BossEncounterSeeder,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    seeder = module.get<BossEncounterSeeder>(BossEncounterSeeder);
  });

  describe('seed()', () => {
    it('should insert boss encounters from bundled data', async () => {
      const result = await seeder.seed();

      expect(result).toEqual({ bossesInserted: 1, lootInserted: 1 });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should resolve boss FKs for loot insertion', async () => {
      await seeder.seed();

      // select() is called to build the boss lookup map
      expect(mockDb.select).toHaveBeenCalled();
    });
  });

  describe('drop()', () => {
    it('should delete loot and boss data', async () => {
      await seeder.drop();

      // delete() called twice: loot first, then bosses
      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });
});
