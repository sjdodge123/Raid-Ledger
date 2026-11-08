/**
 * ROK-1920 — the Blizzard Forever fact source against a real DB: only an
 * Armory-linked, synced, realmless `wow_forever` row is served; while the
 * seam is live (effective prefix `forever`, Armory switch on) its
 * level/class/ilvl/gear win over a newer LedgerLink snapshot regardless of
 * age (ROK-2138), and the switch turns the source off again — the stored
 * row's blizzard-labelled facts still win, the snapshot fills the gaps.
 * Professions/quests/lockouts never come from Blizzard.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { setForeverNamespacePrefix } from '../forever-namespace.resolver';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { WowFactsService } from './wow-facts.service';
import type { RosterCharRef } from './wow-fact.types';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const SYNCED = new Date(NOW.getTime() - 3600 * 1000);
const CAPTURED = new Date(NOW.getTime() - 10 * 60 * 1000);
const EQUIPMENT = {
  equippedItemLevel: 64,
  items: [
    {
      slot: 'HEAD',
      name: 'Lionheart Helm',
      itemId: 12640,
      quality: 'EPIC',
      itemLevel: 63,
      itemSubclass: null,
    },
  ],
  syncedAt: SYNCED.toISOString(),
};
const SNAPSHOT = {
  gear: [{ slot: 1, itemId: 16921, ilvl: 76, bonusIds: [] }],
  talents: { nodes: [] },
  lockouts: [],
  quests: { completed: [7848], inProgress: [] },
};
const PROFESSIONS = {
  primary: [
    {
      id: 164,
      name: 'Blacksmithing',
      slug: 'blacksmithing',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: SYNCED.toISOString(),
};

/** ROK-2107: what the Armory sync wrote (sync-only column). */
const ARMORY_PROFESSIONS = { ...PROFESSIONS, primary: [], secondary: [] };

let testApp: TestApp;
let facts: WowFactsService;
let settings: SettingsService;
const ids: Record<
  'armory' | 'manual' | 'classic' | 'realm' | 'unsynced',
  string
> = { armory: '', manual: '', classic: '', realm: '', unsynced: '' };

type CharValues = Omit<schema.CharacterInsert, 'userId' | 'gameId'>;

async function seedChar(tag: string, values: CharValues): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `bf-${tag}`, username: `bf-${tag}`, role: 'member' })
      .returning(),
    `${tag} user`,
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({ userId: user.id, gameId: testApp.seed.game.id, ...values })
      .returning(),
    `${tag} character`,
  );
  return char.id;
}

async function seedSnapshot(characterId: string, sha: string): Promise<void> {
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId,
    section: 'char',
    schema: 2,
    data: SNAPSHOT,
    capturedAt: CAPTURED,
    payloadSha256: sha.repeat(64),
  });
}

const armorySynced: Partial<CharValues> = {
  externalId: 'bf',
  lastSyncedAt: SYNCED,
};

async function seedAll(): Promise<void> {
  const forever: Partial<CharValues> = {
    gameVariant: 'wow_forever',
    ruleset: 'normal',
  };
  ids.armory = await seedChar('armory', {
    ...forever,
    ...armorySynced,
    name: 'Bfarmory',
    class: 'Warrior',
    race: 'Human',
    role: 'tank',
    level: 60,
    itemLevel: 64,
    equipment: EQUIPMENT,
    professions: PROFESSIONS,
    armoryProfessions: ARMORY_PROFESSIONS,
    addonGuid: 'Player-7-0000BF01',
  });
  ids.manual = await seedChar('manual', {
    ...forever,
    name: 'Bfmanual',
    class: 'Mage',
    level: 58,
    professions: PROFESSIONS,
    addonGuid: 'Player-7-0000BF02',
  });
  await seedSnapshot(ids.armory, 'b');
  await seedSnapshot(ids.manual, 'c');
  ids.classic = await seedChar('classic', {
    ...armorySynced,
    gameVariant: 'classic_era',
    realm: 'Mograine',
    name: 'Bfclassic',
    level: 60,
  });
  ids.realm = await seedChar('realm', {
    ...forever,
    ...armorySynced,
    realm: 'Doomhowl',
    name: 'Bfrealm',
    level: 60,
  });
  ids.unsynced = await seedChar('unsynced', {
    ...forever,
    externalId: 'bf',
    name: 'Bfunsynced',
    level: 60,
  });
}

const refs = (): RosterCharRef[] =>
  Object.entries(ids).map(([key, characterId]) => ({
    key,
    memberId: null,
    characterId,
  }));

beforeAll(async () => {
  testApp = await getTestApp();
  facts = testApp.app.get(WowFactsService);
  settings = testApp.app.get(SettingsService);
  await seedAll();
});

beforeEach(() => setForeverNamespacePrefix('forever'));

afterEach(async () => {
  setForeverNamespacePrefix(null);
  await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'true');
});

describe('BlizzardForeverFactSource.load (real DB)', () => {
  it('serves only the Armory-linked, synced, realmless Forever row', async () => {
    const source = testApp.app.get(BlizzardForeverFactSource);
    const got = await source.load(refs());
    expect([...got.keys()]).toEqual(['armory']);
    expect(got.get('armory')?.level).toEqual({
      value: 60,
      source: 'blizzard',
      asOf: SYNCED,
    });
    // ROK-2107 (supersedes ROK-1920 F11): professions from armory_professions.
    expect(got.get('armory')?.professions).toEqual({
      value: ARMORY_PROFESSIONS,
      source: 'blizzard',
      asOf: SYNCED,
    });
  });
});

describe('WowFactsService.resolveFacts — Blizzard Forever seam (real DB)', () => {
  it('live: blizzard level/class/ilvl/gear win over the newer snapshot', async () => {
    const got = (await facts.resolveFacts(refs())).facts.get('armory');
    expect(got?.level).toEqual({ value: 60, source: 'blizzard', asOf: SYNCED });
    expect(got?.class).toEqual({
      value: 'Warrior',
      source: 'blizzard',
      asOf: SYNCED,
    });
    expect(got?.ilvl).toEqual({ value: 64, source: 'blizzard', asOf: SYNCED });
    expect(got?.gear?.source).toBe('blizzard');
    expect(got?.gear?.value).toEqual([
      {
        slot: 1,
        itemId: 12640,
        ilvl: 63,
        bonusIds: [],
        name: 'Lionheart Helm',
      },
    ]);
    expect(got?.quests?.source).toBe('addon');
    expect(got?.lockouts?.source).toBe('addon');
    // ROK-2107 F0 (2026-11-07): Blizzard wins professions; manual is the fallback.
    expect(got?.professions?.source).toBe('blizzard');
  });

  it('live: the manual Forever row gets nothing blizzard-sourced', async () => {
    const got = (await facts.resolveFacts(refs())).facts.get('manual');
    const sources = Object.values(got ?? {}).map((f) => f?.source);
    expect(sources).not.toContain('blizzard');
    expect(got?.ilvl).toEqual({ value: 76, source: 'addon', asOf: CAPTURED });
    expect(got?.quests?.source).toBe('addon');
    expect(got?.professions?.source).toBe('manual');
  });

  // ROK-2138 OQ-1: the source stops, but the row's stored ilvl is still Blizzard data.
  it('switch off: the row keeps the blizzard ilvl; the snapshot fills the gear', async () => {
    await settings.set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'false');
    const got = (await facts.resolveFacts(refs())).facts.get('armory');
    expect(got?.ilvl).toEqual({ value: 64, source: 'blizzard', asOf: SYNCED });
    expect(got?.gear?.source).toBe('addon');
  });
});
