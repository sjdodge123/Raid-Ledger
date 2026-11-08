/**
 * ROK-1910 — the WoW fact sources + resolver against a real DB: a Forever
 * guild with an unlinked roster row and a linked character that has a
 * LedgerLink snapshot and a manual role override. Asserts each resolved fact
 * and the source it came from.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { MANUAL_PROFESSIONS_WIN } from '../../../characters/characters-professions.helpers';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { CharacterRowFactSource } from './character-row.fact-source';
import { WowFactsService } from './wow-facts.service';

const SNAP = new Date('2026-11-04T20:00:00.000Z');
const CAPTURED = new Date('2026-11-05T08:00:00.000Z');
const NOW = new Date('2026-11-05T12:00:00.000Z');
const GUID = 'Player-7-0000FAC7';
const SNAPSHOT = {
  gear: [
    { slot: 1, itemId: 16921, ilvl: 76, bonusIds: [], enchantId: 2588 },
    { slot: 5, itemId: 16923, ilvl: 70, bonusIds: [] },
  ],
  talents: { nodes: [{ nodeId: 1, rank: 31, tree: 2 }] },
  lockouts: [
    {
      name: 'Molten Core',
      instanceId: 409,
      difficultyId: 9,
      resetAt: 1_762_900_000,
      killed: 3,
      total: 10,
    },
  ],
  quests: { completed: [7848], inProgress: [] },
};

let testApp: TestApp;
let facts: WowFactsService;
let guildId: number;
const memberIds: Record<'linked' | 'unlinked', number> = {
  linked: 0,
  unlinked: 0,
};

async function seedGuild(): Promise<void> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name: 'Forever Facts',
        nameKey: 'forever facts',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  guildId = g.id;
}

async function seedMember(
  name: string,
  guid: string,
  level: number,
  cls: string,
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: name,
        level,
        class: cls,
        rankIndex: 1,
        rankName: 'Raider',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return m.id;
}

async function seedLinkedCharacter(): Promise<void> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'facts-linked', username: 'facts', role: 'member' })
      .returning(),
    'user',
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: 'Lightfang',
        class: 'Priest',
        level: 60,
        role: 'dps',
        roleOverride: 'healer',
        addonGuid: GUID,
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        isMain: true,
      })
      .returning(),
    'character',
  );
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: char.id,
    section: 'char',
    schema: 2,
    data: SNAPSHOT,
    capturedAt: CAPTURED,
    payloadSha256: 'f'.repeat(64),
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  facts = testApp.app.get(WowFactsService);
  await seedGuild();
  memberIds.linked = await seedMember('Lightfang', GUID, 60, 'Priest');
  memberIds.unlinked = await seedMember(
    'Frostbit',
    'Player-7-0000BEEF',
    41,
    'Mage',
  );
  await seedLinkedCharacter();
});

describe('WowFactsService.resolveForGuild (real DB)', () => {
  it('covers every roster row, linked or not', async () => {
    const got = await facts.resolveForGuild(guildId);
    expect([...got.facts.keys()].sort()).toEqual(
      [`m${memberIds.linked}`, `m${memberIds.unlinked}`].sort(),
    );
  });

  it('resolves an unlinked row from the roster alone', async () => {
    const got = (await facts.resolveForGuild(guildId)).facts.get(
      `m${memberIds.unlinked}`,
    );
    expect(got?.level).toEqual({ value: 41, source: 'roster', asOf: SNAP });
    expect(got?.class).toEqual({ value: 'Mage', source: 'roster', asOf: SNAP });
    expect(got?.lastOnline).toEqual({
      value: SNAP,
      source: 'roster',
      asOf: SNAP,
    });
    expect(got?.role).toBeNull();
    expect(got?.gear).toBeNull();
  });

  it('resolves the linked row: manual role, addon gear/quests/lockouts, roster level', async () => {
    const got = (await facts.resolveForGuild(guildId)).facts.get(
      `m${memberIds.linked}`,
    );
    expect(got?.role).toEqual({
      value: 'healer',
      source: 'manual',
      asOf: null,
    });
    expect(got?.gear).toEqual({
      value: SNAPSHOT.gear,
      source: 'addon',
      asOf: CAPTURED,
    });
    expect(got?.ilvl).toEqual({ value: 73, source: 'addon', asOf: CAPTURED });
    expect(got?.quests?.source).toBe('addon');
    expect(got?.lockouts?.value).toEqual(SNAPSHOT.lockouts);
    expect(got?.level).toEqual({ value: 60, source: 'roster', asOf: SNAP });
    expect(got?.professions).toBeNull();
  });
});

/** An Armory-synced row (externalId) whose sync is newer-ish but older than its addon snapshot. */
async function seedArmoryCharacter(): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'facts-armory', username: 'armory', role: 'member' })
      .returning(),
    'armory user',
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: 'Stoneward',
        class: 'Warrior',
        level: 60,
        itemLevel: 61,
        externalId: 'armory-1910',
        lastSyncedAt: new Date(NOW.getTime() - 2 * 3600 * 1000),
        addonGuid: 'Player-7-0000A4B0',
        gameVariant: 'wow_forever',
        ruleset: 'normal',
      })
      .returning(),
    'armory character',
  );
  await testApp.db.insert(schema.characterAddonSnapshots).values({
    characterId: char.id,
    section: 'char',
    schema: 2,
    data: SNAPSHOT,
    capturedAt: new Date(NOW.getTime() - 3600 * 1000),
    payloadSha256: 'e'.repeat(64),
  });
  return char.id;
}

describe('WowFactsService.resolveFacts — CharacterRow Armory row (real DB)', () => {
  afterEach(() =>
    testApp.app.get(SettingsService).set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'true'),
  );

  // ROK-2138 OQ-1/AC7: a stored Armory value still wins with the kill switch off.
  it('a blizzard-labelled row beats a newer addon snapshot while the Armory switch is off', async () => {
    // Since #1979 the alias and a null prefix both resolve to `forever`; only the kill switch turns the seam off.
    await testApp.app
      .get(SettingsService)
      .set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'false');
    const characterId = await seedArmoryCharacter();
    const got = await facts.resolveFacts([
      { key: 'armory', memberId: null, characterId },
    ]);
    expect(got.truncated).toBe(false);
    expect(got.facts.get('armory')?.ilvl).toEqual({
      value: 61,
      source: 'blizzard',
      asOf: new Date(NOW.getTime() - 2 * 3600 * 1000),
    });
    // Gap-fill: the row has no gear, so the snapshot's gear stands.
    expect(got.facts.get('armory')?.gear?.source).toBe('addon');
    expect(got.facts.get('armory')?.class?.source).toBe('blizzard');
  });
});

/** ROK-2107 — a realmless Forever Armory row with a hand entry and/or an Armory value. */
const PROF_SYNCED = new Date(NOW.getTime() - 2 * 3600 * 1000);
const profs = (name: string, skillLevel: number) => ({
  primary: [
    {
      id: 164,
      name,
      slug: name.toLowerCase(),
      skillLevel,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: PROF_SYNCED.toISOString(),
});
const MANUAL_PROFS = profs('Blacksmithing', 150);
const ARMORY_PROFS = profs('Mining', 275);

/** `externalId: null` = a retail import or a refreshed manual Forever row (Codex P2). */
async function seedProfChar(
  tag: string,
  manual: unknown,
  {
    externalId = `prof-${tag}`,
    gameVariant = 'wow_forever',
  }: { externalId?: string | null; gameVariant?: string } = {},
): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `facts-prof-${tag}`,
        username: `prof-${tag}`,
        role: 'member',
      })
      .returning(),
    `${tag} user`,
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: `Prof${tag}`,
        level: 60,
        externalId,
        lastSyncedAt: PROF_SYNCED,
        gameVariant,
        ruleset: 'normal',
        professions: manual,
        armoryProfessions: ARMORY_PROFS,
      })
      .returning(),
    `${tag} character`,
  );
  return char.id;
}

describe('WowFactsService.resolveFacts — professions provenance (ROK-2107, real DB)', () => {
  type Key = 'both' | 'armoryOnly' | 'retailNoExt' | 'foreverNoExt';
  const ids: Record<Key, string> = {
    both: '',
    armoryOnly: '',
    retailNoExt: '',
    foreverNoExt: '',
  };
  const refOf = (key: Key) => ({ key, memberId: null, characterId: ids[key] });
  const resolve = async (key: Key) =>
    (await facts.resolveFacts([refOf(key)])).facts.get(key)?.professions;
  const manualFact = { value: MANUAL_PROFS, source: 'manual', asOf: null };
  const armoryFact = {
    value: ARMORY_PROFS,
    source: 'blizzard',
    asOf: PROF_SYNCED,
  };
  // Ruling F0 (2026-11-07): Blizzard wins; the switch flips it back.
  const expectedBoth = MANUAL_PROFESSIONS_WIN ? manualFact : armoryFact;

  beforeAll(async () => {
    ids.both = await seedProfChar('both', MANUAL_PROFS);
    ids.armoryOnly = await seedProfChar('armory', null);
    ids.retailNoExt = await seedProfChar('retailnoext', MANUAL_PROFS, {
      externalId: null,
      gameVariant: 'retail',
    });
    ids.foreverNoExt = await seedProfChar('forevernoext', MANUAL_PROFS, {
      externalId: null,
    });
  });

  afterEach(() =>
    testApp.app.get(SettingsService).set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'true'),
  );

  it('defaults to Blizzard winning (ruling F0)', () => {
    expect(MANUAL_PROFESSIONS_WIN).toBe(false);
  });

  it('seam live: both values set resolve per MANUAL_PROFESSIONS_WIN', async () => {
    expect(await resolve('both')).toEqual(expectedBoth);
  });

  it('seam live: an Armory-only row resolves to the blizzard value', async () => {
    expect(await resolve('armoryOnly')).toEqual(armoryFact);
  });

  // Review r2 MINOR 2: both sources read the same column, so prove each
  // source's own answer instead of only the resolved fact.
  it('the Blizzard Forever source itself answers professions for a linked row', async () => {
    const got = await testApp.app
      .get(BlizzardForeverFactSource)
      .load([refOf('both'), refOf('foreverNoExt')]);
    expect(got.get('both')?.professions).toEqual(armoryFact);
    expect(got.has('foreverNoExt')).toBe(false);
  });

  it('the row source serves the Armory copy on synced rows without externalId', async () => {
    const got = await testApp.app
      .get(CharacterRowFactSource)
      .load([refOf('retailNoExt'), refOf('foreverNoExt')]);
    expect(got.get('retailNoExt')?.professions).toEqual(armoryFact);
    expect(got.get('foreverNoExt')?.professions).toEqual(armoryFact);
  });

  it.each<Key>(['retailNoExt', 'foreverNoExt'])(
    '%s (synced, no externalId — Codex P2) resolves to the blizzard value',
    async (key) => {
      expect(await resolve(key)).toEqual(armoryFact);
    },
  );

  it('Armory switch off: the row source still serves both cases (F4)', async () => {
    await testApp.app
      .get(SettingsService)
      .set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'false');
    expect(await resolve('both')).toEqual(expectedBoth);
    expect(await resolve('armoryOnly')).toEqual(armoryFact);
  });
});
