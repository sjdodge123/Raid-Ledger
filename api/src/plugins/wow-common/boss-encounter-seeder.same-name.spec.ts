/**
 * ROK-2193: two bosses share a name inside one expansion (Kael'thas
 * Sunstrider in Magisters' Terrace 249 and The Eye 749; Anub'arak in
 * Azjol-Nerub 272 and Trial of the Crusader 757). The loot FK lookup must
 * key by instance so each boss keeps only its own loot, whatever order the
 * boss rows come back from the database on a given boot.
 */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BossEncounterSeeder } from './boss-encounter-seeder';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { wowClassicBossLoot } from '../../drizzle/schema';

const boss = (instanceId: number, name: string, expansion: string) => ({
  instanceId,
  name,
  order: 1,
  expansion,
  sodModified: false,
});

const fakeBosses = [
  boss(249, "Kael'thas Sunstrider", 'tbc'),
  boss(749, "Kael'thas Sunstrider", 'tbc'),
  boss(272, "Anub'arak", 'wotlk'),
  boss(757, "Anub'arak", 'wotlk'),
  boss(409, 'Ragnaros', 'classic'),
];

const loot = (
  bossName: string,
  expansion: string,
  itemId: number,
  instanceId?: number,
): Record<string, unknown> => ({
  bossName,
  expansion,
  itemId,
  itemName: `Item ${itemId}`,
  slot: null,
  quality: 'Epic',
  itemLevel: null,
  dropRate: null,
  classRestrictions: null,
  iconUrl: null,
  itemSubclass: null,
  ...(instanceId === undefined ? {} : { instanceId }),
});

/** Bundled loot rows the current test serves from the mocked JSON file. */
const fakeLoot: Array<Record<string, unknown>> = [];

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
  { id: 21, instanceId: 249, name: "Kael'thas Sunstrider", expansion: 'tbc' },
  { id: 22, instanceId: 749, name: "Kael'thas Sunstrider", expansion: 'tbc' },
  { id: 31, instanceId: 272, name: "Anub'arak", expansion: 'wotlk' },
  { id: 32, instanceId: 757, name: "Anub'arak", expansion: 'wotlk' },
  { id: 41, instanceId: 409, name: 'Ragnaros', expansion: 'classic' },
];

/**
 * Seed once with the stored boss rows returned in `order`, and return the
 * loot rows handed to insert().values() as `itemId → bossId`.
 */
async function seedWithBossOrder(
  order: typeof storedBosses,
): Promise<Record<number, unknown>> {
  const values = jest.fn().mockReturnValue({
    onConflictDoUpdate: jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: 1 }]),
    }),
  });
  const from = jest
    .fn()
    .mockImplementation((table: unknown) =>
      Promise.resolve(table === wowClassicBossLoot ? [] : order),
    );
  const db = {
    insert: jest.fn().mockReturnValue({ values }),
    delete: jest.fn().mockResolvedValue(undefined),
    select: jest.fn().mockReturnValue({ from }),
    transaction: jest.fn().mockResolvedValue(undefined),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      BossEncounterSeeder,
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  await module.get(BossEncounterSeeder).seed();
  const batch = (values.mock.calls[1]?.[0] ?? []) as Array<
    Record<string, unknown>
  >;
  return Object.fromEntries(batch.map((r) => [Number(r.itemId), r.bossId]));
}

/** Seed twice — boss rows in stored order, then reversed (a later boot). */
async function seedTwice(): Promise<Array<Record<number, unknown>>> {
  return [
    await seedWithBossOrder(storedBosses),
    await seedWithBossOrder([...storedBosses].reverse()),
  ];
}

describe('BossEncounterSeeder — same-name bosses (ROK-2193)', () => {
  afterEach(() => {
    fakeLoot.length = 0;
    jest.restoreAllMocks();
  });

  it("hangs each Kael'thas / Anub'arak loot row on its own instance's boss on every boot", async () => {
    fakeLoot.push(
      loot("Kael'thas Sunstrider", 'tbc', 34609, 249),
      loot("Kael'thas Sunstrider", 'tbc', 32458, 749),
      loot("Anub'arak", 'wotlk', 37235, 272),
      loot("Anub'arak", 'wotlk', 47154, 757),
    );
    const expected = { 34609: 21, 32458: 22, 37235: 31, 47154: 32 };
    const [first, second] = await seedTwice();
    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
  });

  it('skips (never guesses) a same-name boss loot row that carries no instance', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    fakeLoot.push(loot("Anub'arak", 'wotlk', 47154));
    const [first, second] = await seedTwice();
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(warn).toHaveBeenCalledWith(
      'Skipping loot "Item 47154" — boss "Anub\'arak" (wotlk) is on more than one instance and the row has no instanceId',
    );
  });

  it('still resolves a unique boss name with no instance on the loot row', async () => {
    fakeLoot.push(loot('Ragnaros', 'classic', 17182));
    const [first, second] = await seedTwice();
    expect(first).toEqual({ 17182: 41 });
    expect(second).toEqual({ 17182: 41 });
  });

  it('skips a loot row whose instanceId matches no boss of that name', async () => {
    fakeLoot.push(loot("Kael'thas Sunstrider", 'tbc', 34609, 999));
    const [first] = await seedTwice();
    expect(first).toEqual({});
  });
});
