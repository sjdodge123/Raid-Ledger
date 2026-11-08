/**
 * ROK-2133 AC-8 + AC-12 against a real DB.
 * AC-8: an unclaimed roster member's verified Armory snapshot
 * (`guild_member_armory`) feeds the roster facts as `source: 'blizzard'`; a
 * member whose ref carries an Armory-linked character gets the character's
 * own facts, never the snapshot's; a snapshot verified against another
 * Blizzard id is ignored.
 * AC-12: the members list (`loadRosterRows` → `groupRoster`) and the claim
 * pick list (`listCandidates`) carry `itemLevel`/`spec`/`role` only for a
 * member with a verified snapshot — the keys are absent otherwise.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { setForeverNamespacePrefix } from '../forever-namespace.resolver';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { groupRoster, loadRosterRows } from '../guilds/guild-roster.helpers';
import { RosterClaimService } from '../guilds/roster-claim/roster-claim.service';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { WowFactsService } from './wow-facts.service';
import type { RosterCharRef } from './wow-fact.types';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SEEN = new Date('2026-11-01T00:00:00Z');
const SNAP_SYNCED = new Date('2026-11-06T09:30:00.000Z');
const CHAR_SYNCED = new Date('2026-11-06T11:00:00.000Z');
const EQUIPMENT = {
  equippedItemLevel: 61,
  items: [
    {
      slot: 'HEAD',
      name: 'Circlet of Prophecy',
      itemId: 16813,
      quality: 'EPIC',
      itemLevel: 66,
      itemSubclass: null,
    },
  ],
  syncedAt: SNAP_SYNCED.toISOString(),
};
const PROFESSIONS = {
  primary: [
    {
      id: 182,
      name: 'Herbalism',
      slug: 'herbalism',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: SNAP_SYNCED.toISOString(),
};

type Who = 'unclaimed' | 'linked' | 'plain' | 'mismatch';

let testApp: TestApp;
let foreverId: number;
let guildId: number;
let linkedCharId: string;
const memberIds = {} as Record<Who, number>;
const names: Record<Who, string> = {
  unclaimed: 'Mfunclaimed',
  linked: 'Mflinked',
  plain: 'Mfplain',
  mismatch: 'Mfmismatch',
};

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertMember(who: Who, blizzardId: number): Promise<void> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        characterName: names[who],
        blizzardCharacterId: blizzardId,
        source: 'blizzard',
        class: 'Priest',
        level: 60,
        lastSeenAt: SEEN,
      })
      .returning({ id: schema.guildMembers.id }),
    `${who} member`,
  );
  memberIds[who] = m.id;
}

async function insertSnapshot(
  who: Who,
  blizzardId: number,
  itemLevel: number,
): Promise<void> {
  await testApp.db.insert(schema.guildMemberArmory).values({
    guildMemberId: memberIds[who],
    blizzardCharacterId: blizzardId,
    level: 60,
    class: 'Priest',
    race: 'Dwarf',
    spec: 'Holy',
    role: 'healer',
    itemLevel,
    equipment: EQUIPMENT,
    armoryProfessions: PROFESSIONS,
    syncedAt: SNAP_SYNCED,
    lastAttemptAt: SNAP_SYNCED,
  });
}

/** An Armory-linked, synced, realmless Forever character (not on the roster's guid). */
async function insertLinkedCharacter(): Promise<string> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'mf-linked', username: 'mf-linked', role: 'member' })
      .returning(),
    'linked user',
  );
  const [char] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: 'Mflinkedchar',
        gameVariant: 'wow_forever',
        ruleset: 'normal',
        externalId: '9202',
        lastSyncedAt: CHAR_SYNCED,
        level: 60,
        class: 'Warrior',
        role: 'tank',
        itemLevel: 70,
      })
      .returning(),
    'linked character',
  );
  return char.id;
}

async function seedAll(): Promise<void> {
  foreverId = await ensureGame();
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name: 'Member Facts Guild',
        nameKey: 'member facts guild',
        source: 'addon_import',
        lastSnapshotAt: SEEN,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  guildId = g.id;
  await insertMember('unclaimed', 9101);
  await insertMember('linked', 9202);
  await insertMember('plain', 9303);
  await insertMember('mismatch', 9404);
  await insertSnapshot('unclaimed', 9101, 61);
  await insertSnapshot('linked', 9202, 50);
  await insertSnapshot('mismatch', 9999, 77);
  linkedCharId = await insertLinkedCharacter();
}

const refs = (): RosterCharRef[] =>
  (Object.keys(names) as Who[]).map((who) => ({
    key: who,
    memberId: memberIds[who],
    characterId: who === 'linked' ? linkedCharId : null,
  }));

beforeAll(async () => {
  testApp = await getTestApp();
  await seedAll();
});

beforeEach(async () => {
  setForeverNamespacePrefix('forever');
  await testApp.app
    .get(SettingsService)
    .set(WOW_FOREVER_ARMORY_IMPORT_KEY, 'true');
});

afterEach(() => setForeverNamespacePrefix(null));

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

describe('roster facts from member Armory snapshots (ROK-2133 AC-8)', () => {
  it('an unclaimed member gets its snapshot facts as source blizzard', async () => {
    const got = (
      await testApp.app.get(WowFactsService).resolveFacts(refs())
    ).facts.get('unclaimed');
    const blizzard = (value: unknown) => ({
      value,
      source: 'blizzard',
      asOf: SNAP_SYNCED,
    });
    expect(got?.role).toEqual(blizzard('healer'));
    expect(got?.ilvl).toEqual(blizzard(61));
    expect(got?.level).toEqual(blizzard(60));
    expect(got?.professions?.source).toBe('blizzard');
    expect(got?.gear?.source).toBe('blizzard');
    expect(got?.gear?.value).toEqual([
      {
        slot: 1,
        itemId: 16813,
        ilvl: 66,
        bonusIds: [],
        name: 'Circlet of Prophecy',
      },
    ]);
  });

  it("a linked Armory character's own facts win over its member's snapshot", async () => {
    const got = await testApp.app.get(BlizzardForeverFactSource).load(refs());
    const linked = got.get('linked');
    expect(linked?.ilvl).toEqual({
      value: 70,
      source: 'blizzard',
      asOf: CHAR_SYNCED,
    });
    expect(linked?.role?.value).toBe('tank');
    expect(linked?.professions).toBeUndefined();
  });

  it('serves nothing for a member without a snapshot or with a mismatched one', async () => {
    const got = await testApp.app.get(BlizzardForeverFactSource).load(refs());
    expect(got.has('plain')).toBe(false);
    expect(got.has('mismatch')).toBe(false);
  });
});

describe('members list + pick list Armory fields (ROK-2133 AC-12)', () => {
  const ARMORY_KEYS = ['itemLevel', 'spec', 'role'];
  it('the members list carries the snapshot fields only when present', async () => {
    const rows = groupRoster(await loadRosterRows(testApp.db, guildId)).flatMap(
      (g) => g.members,
    );
    const byName = (who: Who) =>
      nonEmpty(
        rows.filter((r) => r.name === names[who]),
        `${who} roster row`,
      )[0];
    expect(byName('unclaimed')).toMatchObject({
      memberId: memberIds.unclaimed,
      itemLevel: 61,
      spec: 'Holy',
      role: 'healer',
    });
    for (const who of ['plain', 'mismatch'] as const) {
      const row = byName(who);
      expect(row).toMatchObject({ memberId: memberIds[who], level: 60 });
      for (const key of ARMORY_KEYS) expect(row).not.toHaveProperty(key);
    }
  });

  it('the pick list carries the snapshot fields only when present', async () => {
    const list = await testApp.app
      .get(RosterClaimService)
      .listCandidates({ gameId: String(foreverId) });
    const candidates = list.guilds.flatMap((g) => g.candidates);
    const byName = (who: Who) =>
      nonEmpty(
        candidates.filter((c) => c.name === names[who]),
        `${who} candidate`,
      )[0];
    expect(byName('unclaimed')).toMatchObject({
      memberId: memberIds.unclaimed,
      itemLevel: 61,
      spec: 'Holy',
      role: 'healer',
      source: 'blizzard',
    });
    for (const who of ['plain', 'mismatch'] as const) {
      const c = byName(who);
      expect(c).toMatchObject({ memberId: memberIds[who], class: 'Priest' });
      for (const key of ARMORY_KEYS) expect(c).not.toHaveProperty(key);
    }
  });
});

describe('GUID-less roster members (ROK-2133 Codex P2)', () => {
  // Codex P2: `linked` has no addon GUID, so the roster never joins it to the
  // Armory character holding its Blizzard id — its own snapshot must serve.
  // (The pick list's GUID-less case is `unclaimed`, AC-12 above; `linked` is not a
  // candidate there because a character holds its id.)
  it('a GUID-less member whose id an Armory character holds shows its own snapshot (members list + roster facts)', async () => {
    const raw = await loadRosterRows(testApp.db, guildId);
    const row = nonEmpty(
      raw.filter((r) => r.memberId === memberIds.linked),
      'guid-less roster row',
    )[0];
    expect(row.characterId).toBeNull();
    const listed = groupRoster(raw)
      .flatMap((g) => g.members)
      .find((m) => m.memberId === memberIds.linked);
    expect(listed).toMatchObject({
      itemLevel: 50,
      spec: 'Holy',
      role: 'healer',
    });
    const facts = await testApp.app
      .get(BlizzardForeverFactSource)
      .load([{ key: 'linked', memberId: row.memberId, characterId: null }]);
    expect(facts.get('linked')?.ilvl).toEqual({
      value: 50,
      source: 'blizzard',
      asOf: SNAP_SYNCED,
    });
  });
});
