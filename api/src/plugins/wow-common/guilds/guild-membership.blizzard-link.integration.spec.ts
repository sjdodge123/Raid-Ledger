/**
 * ROK-2115 — an Armory-imported character (`characters.external_id`) links to
 * a Blizzard-sourced roster row (`guild_members.blizzard_character_id`, guid
 * NULL) through THE shared `characterLink()` (spec "Tests by tier" cases 1, 2,
 * 3, 4, 5 and 9). Seeds rows directly and reads the membership helpers, so
 * every assertion names the link arm it proves. Mutation map: drop arm B →
 * case 1 red; drop the strict-region clause (or reuse the GUID arm's
 * unknown-region leniency) → case 2 / 2b red; drop GUID-wins → case 3 red;
 * drop the other-live-row suppression → case 4 red; restore a guid-only join
 * in `loadRosterMemberIds` / `loadDingRows` → case 1 red; an uncorrelated
 * `guidLinkedToAny` → the Ruling 6 linkVia case red.
 */
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import {
  findLinkDisagreements,
  logLinkDisagreements,
} from './guild-link.disagreements';
import {
  findLinkedMemberRows,
  findLinkedMemberUserIds,
} from './guild-membership.helpers';
import {
  CHARACTER_CLAIM_ENTITY,
  ROSTER_CLAIMED_ACTION,
} from '../../../characters/characters-roster-claim.helpers';
import { loadRosterLinks } from './guild-roster-links.helpers';
import { loadRosterMemberIds, loadRosterRows } from './guild-roster.helpers';
import { loadDingRows } from './recent-dings/recent-dings.queries';

const SNAP = new Date('2026-11-08T12:00:00.000Z');
const OLD = new Date('2026-10-01T12:00:00.000Z');

let testApp: TestApp;
let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

async function insertGuild(region = 'us'): Promise<number> {
  const name = `Blizzard Link 2115 ${next()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region,
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function insertUser(deactivated = false): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:blizzard-link-2115-${n}@test`,
        username: `BlizzLink2115_${n}`,
        role: 'member',
        deactivatedAt: deactivated ? SNAP : null,
      })
      .returning(),
    'user',
  );
  return u.id;
}

interface CharOpts {
  externalId?: string;
  addonGuid?: string;
  region?: string | null;
}

async function insertChar(userId: number, o: CharOpts): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: testApp.seed.game.id,
        name: `LinkChar${next()}`,
        role: 'dps',
        isMain: false,
        region: o.region === undefined ? 'us' : o.region,
        externalId: o.externalId ?? null,
        addonGuid: o.addonGuid ?? null,
      })
      .returning(),
    'character',
  );
  return c.id;
}

interface RowOpts {
  guid?: string;
  blizzardId?: number;
  seenAt?: Date;
}

async function insertRow(guildId: number, o: RowOpts): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid: o.guid ?? null,
        blizzardCharacterId: o.blizzardId ?? null,
        characterName: `Row${next()}`,
        rankIndex: 3,
        rankName: 'Member',
        source: o.guid ? 'addon_import' : 'blizzard',
        lastSeenAt: o.seenAt ?? SNAP,
      })
      .returning(),
    'member row',
  );
  return m.id;
}

async function insertDing(guildId: number, memberId: number): Promise<void> {
  await testApp.db.insert(schema.guildMemberLevelEvents).values({
    guildId,
    guildMemberId: memberId,
    fromLevel: 59,
    toLevel: 60,
    occurredAt: SNAP,
  });
}

/** The ROK-2128 roster-pick audit row `rosterPicked()` reads. */
async function insertRosterClaimAudit(
  userId: number,
  characterId: string,
): Promise<void> {
  await testApp.db.insert(schema.activityLog).values({
    entityType: CHARACTER_CLAIM_ENTITY,
    entityId: userId,
    action: ROSTER_CLAIMED_ACTION,
    actorId: userId,
    metadata: { characterId },
  });
}

const blizzardId = (): number => 900_000_000 + next();
const guid = (): string => `Player-2115-${next()}`;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(() => jest.restoreAllMocks());

describe('ROK-2115 Blizzard-id link (arm B)', () => {
  it('case 1: an Armory char links to a GUID-less Blizzard row — member, fan-out, roster', async () => {
    const guildId = await insertGuild();
    const userId = await insertUser();
    const id = blizzardId();
    const charId = await insertChar(userId, { externalId: String(id) });
    const memberId = await insertRow(guildId, { blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([
      { guildId, memberId, rankIndex: 3, characterId: charId, via: 'blizzard' },
    ]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([
      userId,
    ]);
    const roster = await loadRosterRows(testApp.db, guildId);
    expect(roster.map((r) => [r.memberId, r.characterId, r.userId])).toEqual([
      [memberId, charId, userId],
    ]);
    // Review m4 (AC3): the member-id map and the dings feed resolve it too.
    expect(await loadRosterMemberIds(testApp.db, guildId, [charId])).toEqual(
      new Map([[charId, memberId]]),
    );
    await insertDing(guildId, memberId);
    const dings = await loadDingRows(testApp.db, guildId, OLD, 10);
    expect(dings.map((d) => [d.characterId, d.toLevel])).toEqual([
      [charId, 60],
    ]);
  });

  it('case 2: a same-id character in another region never links', async () => {
    const guildId = await insertGuild('us');
    const userId = await insertUser();
    const id = blizzardId();
    await insertChar(userId, { externalId: String(id), region: 'eu' });
    await insertRow(guildId, { blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([]);
  });

  it('case 2b: a same-id character with an unknown (NULL) region never links', async () => {
    const guildId = await insertGuild('us');
    const userId = await insertUser();
    const id = blizzardId();
    await insertChar(userId, { externalId: String(id), region: null });
    await insertRow(guildId, { blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([]);
  });
});

describe('ROK-2115 GUID wins (Ruling 3)', () => {
  it('case 3: GUID beats Blizzard id on disagreement, and the disagreement is logged by id', async () => {
    const guildId = await insertGuild();
    const [userA, userB] = [await insertUser(), await insertUser()];
    const [g, id] = [guid(), blizzardId()];
    const charA = await insertChar(userA, { addonGuid: g });
    const charB = await insertChar(userB, { externalId: String(id) });
    const memberId = await insertRow(guildId, { guid: g, blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userA, guildId)).toEqual([
      { guildId, memberId, rankIndex: 3, characterId: charA, via: 'guid' },
    ]);
    expect(await findLinkedMemberRows(testApp.db, userB, guildId)).toEqual([]);
    const pair = {
      guildId,
      memberId,
      guidCharacterId: charA,
      blizzardCharacterId: charB,
    };
    expect(await findLinkDisagreements(testApp.db, guildId)).toEqual([pair]);

    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    await logLinkDisagreements(testApp.db, guildId);
    expect(warn).toHaveBeenCalledWith({
      msg: 'roster link disagreement',
      ...pair,
    });
  });

  it('case 4: a character GUID-linked to R1 does not also Blizzard-link a duplicate R2', async () => {
    const guildId = await insertGuild();
    const userId = await insertUser();
    const [g, id] = [guid(), blizzardId()];
    const charId = await insertChar(userId, {
      addonGuid: g,
      externalId: String(id),
    });
    const r1 = await insertRow(guildId, { guid: g });
    await insertRow(guildId, { blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([
      { guildId, memberId: r1, rankIndex: 3, characterId: charId, via: 'guid' },
    ]);
  });
});

/** [characterId, userId] per roster row, as the roster page reads it. */
async function rosterLinks(guildId: number): Promise<unknown[][]> {
  const rows = await loadRosterRows(testApp.db, guildId);
  return rows.map((r) => [r.characterId, r.userId]);
}

describe('ROK-2160 a deactivated GUID holder does not win the row', () => {
  it('case 2160-1: deactivated GUID holder + active Blizzard-id holder → the active one', async () => {
    const guildId = await insertGuild();
    const [gone, active] = [await insertUser(true), await insertUser()];
    const [g, id] = [guid(), blizzardId()];
    const goneChar = await insertChar(gone, { addonGuid: g });
    const activeChar = await insertChar(active, { externalId: String(id) });
    const memberId = await insertRow(guildId, { guid: g, blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, active, guildId)).toEqual([
      {
        guildId,
        memberId,
        rankIndex: 3,
        characterId: activeChar,
        via: 'blizzard',
      },
    ]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([
      active,
    ]);
    expect(await rosterLinks(guildId)).toEqual([[activeChar, active]]);
    // Not a disagreement: the deactivated holder never wins the row.
    expect(await findLinkDisagreements(testApp.db, guildId)).toEqual([]);
    expect(goneChar).not.toEqual(activeChar);
  });

  it('case 2160-2: an ACTIVE GUID holder still beats the Blizzard-id holder', async () => {
    const guildId = await insertGuild();
    const [guidUser, blizzUser] = [await insertUser(), await insertUser()];
    const [g, id] = [guid(), blizzardId()];
    const guidChar = await insertChar(guidUser, { addonGuid: g });
    await insertChar(blizzUser, { externalId: String(id) });
    await insertRow(guildId, { guid: g, blizzardId: id });

    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([
      guidUser,
    ]);
    expect(await findLinkedMemberRows(testApp.db, blizzUser, guildId)).toEqual(
      [],
    );
    expect(await rosterLinks(guildId)).toEqual([[guidChar, guidUser]]);
  });

  it('case 2160-3: deactivated GUID holder and no active holder → unlinked', async () => {
    const guildId = await insertGuild();
    const gone = await insertUser(true);
    const [g, id] = [guid(), blizzardId()];
    await insertChar(gone, { addonGuid: g });
    await insertRow(guildId, { guid: g, blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, gone, guildId)).toEqual([]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([]);
    expect(await rosterLinks(guildId)).toEqual([[null, null]]);
  });
});

describe('ROK-2115 existing membership rules apply to arm B', () => {
  it('case 5: a Blizzard row outside the latest snapshot confers nothing', async () => {
    const guildId = await insertGuild();
    const userId = await insertUser();
    const id = blizzardId();
    await insertChar(userId, { externalId: String(id) });
    await insertRow(guildId, { blizzardId: id, seenAt: OLD });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([]);
  });

  it('case 9: a deactivated owner is not a member through a Blizzard link', async () => {
    const guildId = await insertGuild();
    const userId = await insertUser(true);
    const id = blizzardId();
    await insertChar(userId, { externalId: String(id) });
    await insertRow(guildId, { blizzardId: id });

    expect(await findLinkedMemberRows(testApp.db, userId, guildId)).toEqual([]);
    expect(await findLinkedMemberUserIds(testApp.db, guildId)).toEqual([]);
    // Review n2: the roster row shows unlinked, not linked to the deactivated user.
    const roster = await loadRosterRows(testApp.db, guildId);
    expect(roster.map((r) => [r.characterId, r.userId])).toEqual([
      [null, null],
    ]);
  });
});

describe('ROK-2115 Ruling 6: staff linkVia on a real DB (review m5)', () => {
  it('labels an Armory-only link armory, a GUID link import, a roster pick roster_pick', async () => {
    const guildId = await insertGuild();
    const [armoryUser, importUser, pickUser] = [
      await insertUser(),
      await insertUser(),
      await insertUser(),
    ];
    const id = blizzardId();
    const [g1, g2] = [guid(), guid()];
    const armoryChar = await insertChar(armoryUser, { externalId: String(id) });
    const importChar = await insertChar(importUser, { addonGuid: g1 });
    const pickChar = await insertChar(pickUser, { addonGuid: g2 });
    await insertRow(guildId, { blizzardId: id });
    await insertRow(guildId, { guid: g1 });
    await insertRow(guildId, { guid: g2 });
    await insertRosterClaimAudit(pickUser, pickChar);

    const links = await loadRosterLinks(
      testApp.db,
      await loadRosterRows(testApp.db, guildId),
    );
    expect(
      [armoryChar, importChar, pickChar].map((c) => links.get(c)?.linkVia),
    ).toEqual(['armory', 'import', 'roster_pick']);
  });
});
