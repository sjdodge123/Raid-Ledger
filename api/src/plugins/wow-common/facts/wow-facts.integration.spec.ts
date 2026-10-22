/**
 * ROK-1910 — the WoW fact sources + resolver against a real DB: a Forever
 * guild with an unlinked roster row and a linked character that has a
 * LedgerLink snapshot and a manual role override. Asserts each resolved fact
 * and the source it came from.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
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
    const got = await facts.resolveForGuild(guildId, NOW);
    expect([...got.keys()].sort()).toEqual(
      [`m${memberIds.linked}`, `m${memberIds.unlinked}`].sort(),
    );
  });

  it('resolves an unlinked row from the roster alone', async () => {
    const got = (await facts.resolveForGuild(guildId, NOW)).get(
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
    const got = (await facts.resolveForGuild(guildId, NOW)).get(
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
