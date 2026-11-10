import { Test, TestingModule } from '@nestjs/testing';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { wowClassicBossLoot } from '../../drizzle/schema';
import * as pruneHelpers from './boss-encounter-prune.helpers';

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

const storedBosses = [
  { id: 1, instanceId: 409, name: 'Ragnaros', expansion: 'classic' },
  { id: 2, instanceId: 409, name: 'Lucifron', expansion: 'classic' },
];

const storedLoot = [
  { id: 10, bossId: 1, itemId: 17182, expansion: 'classic' },
  // Retail leftover on a KEPT boss — no longer in boss-loot-data.json.
  { id: 11, bossId: 2, itemId: 151403, expansion: 'classic' },
];

let seeder: BossEncounterSeeder;
let mockDb: {
  insert: jest.Mock;
  delete: jest.Mock;
  select: jest.Mock;
  transaction: jest.Mock;
};

async function setupEach() {
  const mockReturning = jest.fn().mockResolvedValue([{ id: 1 }]);
  const mockOnConflictDoUpdate = jest
    .fn()
    .mockReturnValue({ returning: mockReturning });
  const mockValues = jest
    .fn()
    .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });

  // Mock for select().from() — boss rows for loot FK resolution, and the
  // stored loot rows for the stale-loot prune (ROK-2142 review r1).
  const mockFrom = jest
    .fn()
    .mockImplementation((table: unknown) =>
      Promise.resolve(table === wowClassicBossLoot ? storedLoot : storedBosses),
    );

  mockDb = {
    insert: jest.fn().mockReturnValue({ values: mockValues }),
    delete: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockReturnValue({ from: mockFrom }),
    transaction: jest.fn().mockResolvedValue(undefined),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BossEncounterSeeder,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();

  seeder = module.get<BossEncounterSeeder>(BossEncounterSeeder);
}

describe('BossEncounterSeeder', () => {
  beforeEach(() => setupEach());

  describe('seed()', () => {
    it('should insert boss encounters from bundled data', async () => {
      const result = await seeder.seed();

      expect(result.bossesInserted).toBeGreaterThan(0);
      expect(result.lootInserted).toBeGreaterThan(0);
      // insert() called twice: once for bosses, once for loot
      expect(mockDb.insert).toHaveBeenCalledTimes(2);
    });

    it('should resolve boss FKs for loot insertion', async () => {
      await seeder.seed();

      // select() for the boss lookup map, then for the stored loot rows
      expect(mockDb.select).toHaveBeenCalledTimes(2);
    });

    it('prunes classic loot rows no longer in the JSON on kept bosses (review r1)', async () => {
      // The fake JSON is 2 bosses / 1 loot row, far below the production
      // floors (ROK-2168), so this test runs the REAL stale-row helpers with
      // a floor of 1. The production floors are pinned in
      // boss-encounter-prune.helpers.spec.ts and data/classic-boss-lists.spec.ts.
      const realBoss = pruneHelpers.findStaleClassicBossIds;
      const realLoot = pruneHelpers.findStaleClassicLootIds;
      const bossSpy = jest
        .spyOn(pruneHelpers, 'findStaleClassicBossIds')
        .mockImplementation((rows, json, warn) =>
          realBoss(rows, json, warn, 1),
        );
      const lootSpy = jest
        .spyOn(pruneHelpers, 'findStaleClassicLootIds')
        .mockImplementation((rows, wanted, ids, warn) =>
          realLoot(rows, wanted, ids, warn, 1),
        );
      const prune = jest.spyOn(pruneHelpers, 'pruneClassicRows');
      await seeder.seed();
      expect(prune).toHaveBeenCalledWith(mockDb, [], [11]);
      prune.mockRestore();
      bossSpy.mockRestore();
      lootSpy.mockRestore();
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
