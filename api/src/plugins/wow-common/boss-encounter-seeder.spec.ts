import { Logger } from '@nestjs/common';
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

/** Extra JSON loot rows a test appends (ROK-2170 Forever fallback cases). */
const extraLoot: Array<Record<string, unknown>> = [];

jest.mock('fs/promises', () => ({
  readFile: jest.fn().mockImplementation((path: string) => {
    if (path.includes('boss-encounter-data'))
      return Promise.resolve(JSON.stringify(fakeBosses));
    if (path.includes('boss-loot-data'))
      return Promise.resolve(JSON.stringify([...fakeLoot, ...extraLoot]));
    return Promise.reject(new Error(`Unexpected readFile: ${path}`));
  }),
}));

const storedBosses = [
  { id: 1, instanceId: 409, name: 'Ragnaros', expansion: 'classic' },
  { id: 2, instanceId: 409, name: 'Lucifron', expansion: 'classic' },
];

/** Extra stored boss rows a test appends (ROK-2170). */
const extraBosses: Array<Record<string, unknown>> = [];

const storedLoot = [
  { id: 10, bossId: 1, itemId: 17182, expansion: 'classic' },
  // Retail leftover on a KEPT boss — no longer in boss-loot-data.json.
  { id: 11, bossId: 2, itemId: 151403, expansion: 'classic' },
];

/** Extra stored loot rows a test appends (ROK-2170 D7). */
const extraStoredLoot: Array<Record<string, unknown>> = [];

let seeder: BossEncounterSeeder;
let mockValues: jest.Mock;
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
  mockValues = jest
    .fn()
    .mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });

  // Mock for select().from() — boss rows for loot FK resolution, and the
  // stored loot rows for the stale-loot prune (ROK-2142 review r1).
  const mockFrom = jest
    .fn()
    .mockImplementation((table: unknown) =>
      Promise.resolve(
        table === wowClassicBossLoot
          ? [...storedLoot, ...extraStoredLoot]
          : [...storedBosses, ...extraBosses],
      ),
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
      const prune = jest.spyOn(pruneHelpers, 'pruneStaleRows');
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

/**
 * Run seed() with the REAL stale-row helpers at a floor of 1 (the fake JSON
 * is far below the production floors) and return the loot ids it prunes.
 */
async function prunedLootIds(): Promise<unknown> {
  const realBoss = pruneHelpers.findStaleClassicBossIds;
  const realClassic = pruneHelpers.findStaleClassicLootIds;
  const realForever = pruneHelpers.findStaleForeverLootIds;
  jest
    .spyOn(pruneHelpers, 'findStaleClassicBossIds')
    .mockImplementation((r, j, w) => realBoss(r, j, w, 1));
  jest
    .spyOn(pruneHelpers, 'findStaleClassicLootIds')
    .mockImplementation((r, l, ids, w) => realClassic(r, l, ids, w, 1));
  jest
    .spyOn(pruneHelpers, 'findStaleForeverLootIds')
    .mockImplementation((r, l, ids, w) => realForever(r, l, ids, w, 1));
  const prune = jest.spyOn(pruneHelpers, 'pruneStaleRows');
  await seeder.seed();
  return prune.mock.calls[0]?.[2];
}

describe('BossEncounterSeeder — Forever loot (ROK-2170)', () => {
  beforeEach(() => setupEach());

  const foreverRow = (bossName: string) => ({
    ...fakeLoot[0],
    bossName,
    expansion: 'forever',
    itemId: 99001,
    itemName: 'Forever Blade',
  });
  /** The loot batch handed to insert().values() (second insert call). */
  const insertedLoot = (): Array<Record<string, unknown>> =>
    (mockValues.mock.calls[1]?.[0] ?? []) as Array<Record<string, unknown>>;

  afterEach(() => {
    extraLoot.length = 0;
    extraBosses.length = 0;
  });

  it('attaches a forever loot row to the classic boss of the same name', async () => {
    extraLoot.push(foreverRow('Lucifron'));
    await seeder.seed();
    const row = insertedLoot().find((l) => l.itemId === 99001);
    expect(row).toMatchObject({ bossId: 2, expansion: 'forever' });
  });

  it('prefers a forever boss row over the classic one when both exist', async () => {
    extraBosses.push({
      id: 3,
      instanceId: 409,
      name: 'Lucifron',
      expansion: 'forever',
    });
    extraLoot.push(foreverRow('Lucifron'));
    await seeder.seed();
    const row = insertedLoot().find((l) => l.itemId === 99001);
    expect(row).toMatchObject({ bossId: 3, expansion: 'forever' });
  });

  it('skips and warns on a forever row for an unknown boss', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    extraLoot.push(foreverRow('Nobody'));
    await seeder.seed();
    expect(insertedLoot().map((l) => l.itemId)).not.toContain(99001);
    expect(warn).toHaveBeenCalledWith(
      'Skipping loot "Forever Blade" — boss "Nobody" (forever) not found',
    );
    warn.mockRestore();
  });
});

describe('BossEncounterSeeder — Forever loot prune (ROK-2170 D7)', () => {
  beforeEach(() => setupEach());

  const foreverRow = (bossName: string) => ({
    ...fakeLoot[0],
    bossName,
    expansion: 'forever',
    itemId: 99001,
    itemName: 'Forever Blade',
  });

  afterEach(() => {
    extraLoot.length = 0;
    extraStoredLoot.length = 0;
    jest.restoreAllMocks();
  });

  it('keeps a bundled forever row stored on its classic boss (D7)', async () => {
    extraLoot.push(foreverRow('Lucifron'));
    extraStoredLoot.push({
      id: 20,
      bossId: 2,
      itemId: 99001,
      expansion: 'forever',
    });
    expect(await prunedLootIds()).toEqual([11]);
  });

  it('prunes a stored forever row removed from the JSON and leaves classic rows alone (D7)', async () => {
    extraLoot.push(foreverRow('Lucifron'));
    extraStoredLoot.push(
      { id: 20, bossId: 2, itemId: 99001, expansion: 'forever' },
      { id: 21, bossId: 2, itemId: 99002, expansion: 'forever' },
    );
    // 10 (bundled classic on boss 1) and 20 (bundled forever) stay; 11 is the
    // classic retail leftover the classic prune already removes.
    expect(await prunedLootIds()).toEqual([11, 21]);
  });
});
