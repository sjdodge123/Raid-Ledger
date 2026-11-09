/**
 * ROK-2128 L2 — `POST /plugins/wow/roster-claim/members/:memberId/claim`
 * against a real database: the D5 claim tx (locks, locked re-check, insert),
 * D4 GUID pin + `addon_guid_claimed` audit with `via:'roster_pick'` (operator
 * ruling: the claimer is a guild member at once), Blizzard rows set
 * `external_id` only (ROK-2115: that id link makes the claimer a member
 * too), the concurrent double-claim race, 404s and 400s.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { findLinkedMemberRows } from '../guild-membership.helpers';
import { claimWithin, readMember, ROSTER_ROW_CHANGED } from './roster-claim.tx';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const STALE = new Date('2026-10-01T00:00:00Z');
const BODY = { ruleset: 'normal' };

let testApp: TestApp;
let foreverId: number;
let guildId: number;
let hiddenGuildId: number;
const members = new Map<string, number>();

async function ensureGame(slug: string): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, slug));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(
  name: string,
  extra: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAPSHOT,
        ...extra,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

type MemberSeed = Partial<typeof schema.guildMembers.$inferInsert> & {
  characterName: string;
};

async function insertMember(gid: number, seed: MemberSeed): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId: gid,
        source: 'addon_import',
        lastSeenAt: SNAPSHOT,
        ...seed,
      })
      .returning({ id: schema.guildMembers.id }),
    'member',
  );
  members.set(seed.characterName, m.id);
  return m.id;
}

function memberId(name: string): number {
  const id = members.get(name);
  if (id === undefined) throw new Error(`no seeded member ${name}`);
  return id;
}

/** A local-login member; returns its id and access token. */
async function makeUser(
  handle: string,
): Promise<{ id: number; token: string }> {
  // Login looks the credential up by the LOWER-cased email, so it is stored
  // lower-cased here (a mixed-case handle like 'l2raceA' otherwise 401s).
  const email = `${handle}@roster-claim-l2.test`.toLowerCase();
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: handle, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token: unknown = res.body.access_token;
  if (typeof token !== 'string') {
    throw new Error(`makeUser(${handle}): /auth/local ${res.status}, no token`);
  }
  return { id: user.id, token };
}

async function seedRoster(): Promise<void> {
  guildId = await insertGuild('Claim Guild');
  hiddenGuildId = await insertGuild('Claim Hidden', { hiddenAt: SNAPSHOT });
  await insertMember(guildId, {
    characterName: 'Ashen Vale',
    guid: 'G-L2-ASHEN',
    class: 'Mage',
    level: 60,
  });
  await insertMember(guildId, {
    characterName: 'Brine Hollow',
    blizzardCharacterId: 9555,
    source: 'blizzard',
    class: 'Priest',
    level: 42,
  });
  await insertMember(guildId, {
    characterName: 'Cinder Mark',
    guid: 'G-L2-CINDER',
  });
  await insertMember(guildId, {
    characterName: 'Race Prize',
    guid: 'G-L2-RACE',
  });
  await insertMember(guildId, { characterName: 'Own Name' });
  await insertMember(guildId, {
    characterName: 'Gone Away',
    lastSeenAt: STALE,
  });
  await insertMember(hiddenGuildId, {
    characterName: 'Hidden Row',
    guid: 'G-L2-H',
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame(FOREVER_SLUG);
  await seedRoster();
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const claim = (id: number, token: string, body: object = BODY) =>
  testApp.request
    .post(`/plugins/wow/roster-claim/members/${id}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

async function charactersNamed(name: string) {
  return testApp.db
    .select()
    .from(schema.characters)
    .where(
      and(
        eq(schema.characters.gameId, foreverId),
        eq(schema.characters.name, name),
      ),
    );
}

async function auditRows(entityType: string, action: string, ownerId: number) {
  return testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, entityType),
        eq(schema.activityLog.action, action),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
}

describe('POST /plugins/wow/roster-claim/members/:memberId/claim (ROK-2128)', () => {
  it('claims a GUID row: pins the GUID, audits roster_pick, makes a member (D4)', async () => {
    const picker = await makeUser('l2ashen');
    const res = await claim(memberId('Ashen Vale'), picker.token);
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Ashen Vale');
    const [row] = nonEmpty(await charactersNamed('Ashen Vale'), 'claimed row');
    expect(row).toMatchObject({
      userId: picker.id,
      addonGuid: 'G-L2-ASHEN',
      region: 'us',
      ruleset: 'normal',
      realm: null,
      class: 'Mage',
      level: 60,
      isMain: true,
    });
    const [guidAudit] = await auditRows(
      'addon_guid',
      'addon_guid_claimed',
      picker.id,
    );
    expect(guidAudit?.metadata).toMatchObject({
      via: 'roster_pick',
      guid: 'G-L2-ASHEN',
    });
    const [claimAudit] = await auditRows(
      'character_claim',
      'roster_claimed',
      picker.id,
    );
    expect(claimAudit?.metadata).toMatchObject({
      characterId: row.id,
      guildId,
      memberId: memberId('Ashen Vale'),
      toUserId: picker.id,
      actorId: picker.id,
    });
    const links = await findLinkedMemberRows(testApp.db, picker.id, guildId);
    expect(links.map((l) => l.memberId)).toEqual([memberId('Ashen Vale')]);
  });
});

describe('roster claim: Blizzard rows and conflicts (ROK-2128)', () => {
  // ROK-2115 case 6 (intended behaviour change): the claimed character's
  // `external_id` now links it to the Blizzard row through `characterLink()`
  // arm B, so the claimer is a guild member in the same request (the ROK-2132
  // members-only loop). Before 2115 this asserted "not yet a member".
  it('claims a Blizzard row: sets external_id, no GUID, audits the id link, makes a member (ROK-2115)', async () => {
    const picker = await makeUser('l2brine');
    const res = await claim(memberId('Brine Hollow'), picker.token);
    expect(res.status).toBe(201);
    const [row] = nonEmpty(
      await charactersNamed('Brine Hollow'),
      'claimed row',
    );
    expect(row).toMatchObject({
      userId: picker.id,
      externalId: '9555',
      addonGuid: null,
    });
    expect(
      await auditRows('addon_guid', 'addon_guid_claimed', picker.id),
    ).toEqual([]);
    const [idAudit] = await auditRows(
      'addon_guid',
      'external_id_linked',
      picker.id,
    );
    expect(idAudit?.metadata).toMatchObject({
      characterId: row.id,
      externalId: '9555',
      via: 'roster_pick',
    });
    const links = await findLinkedMemberRows(testApp.db, picker.id, guildId);
    expect(
      links.map((l) => ({
        memberId: l.memberId,
        characterId: l.characterId,
        via: l.via,
      })),
    ).toEqual([
      {
        memberId: memberId('Brine Hollow'),
        characterId: row.id,
        via: 'blizzard',
      },
    ]);
    // CharacterDto.rosterClaimed: the admin slot's self-filter for a no-GUID row.
    expect(res.body.rosterClaimed).toBe(true);
    const detail = await testApp.request.get(`/characters/${row.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rosterClaimed).toBe(true);
  });
});

describe('CharacterDto.rosterClaimed (ROK-2128)', () => {
  it('a manually added character is not rosterClaimed on the detail read', async () => {
    const owner = await makeUser('l2manual');
    const [row] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({
          userId: owner.id,
          gameId: foreverId,
          name: 'Manual Only',
          region: 'us',
        })
        .returning(),
      'manual row',
    );
    const detail = await testApp.request.get(`/characters/${row.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rosterClaimed).toBe(false);
  });
});

describe('roster claim: conflicts (ROK-2128)', () => {
  it('a claimed row is 409 "Someone claimed this first" for the next caller', async () => {
    const first = await makeUser('l2cinderA');
    const second = await makeUser('l2cinderB');
    expect((await claim(memberId('Cinder Mark'), first.token)).status).toBe(
      201,
    );
    const res = await claim(memberId('Cinder Mark'), second.token);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Someone claimed this first');
    expect(await charactersNamed('Cinder Mark')).toHaveLength(1);
  });

  it('two simultaneous claims of one row: exactly one 201, one 409 (race)', async () => {
    const a = await makeUser('l2raceA');
    const b = await makeUser('l2raceB');
    const id = memberId('Race Prize');
    const results = await Promise.all([claim(id, a.token), claim(id, b.token)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser?.body.message).toBe('Someone claimed this first');
    const rows = await charactersNamed('Race Prize');
    expect(rows).toHaveLength(1);
  });

  it('a name the caller already owns manually is 409, no second row', async () => {
    const picker = await makeUser('l2ownname');
    await testApp.db.insert(schema.characters).values({
      userId: picker.id,
      gameId: foreverId,
      name: 'own name',
      region: 'us',
    });
    const res = await claim(memberId('Own Name'), picker.token);
    expect(res.status).toBe(409);
    expect(await charactersNamed('Own Name')).toEqual([]);
  });
});

describe('roster claim refusals (ROK-2128)', () => {
  it('404s an unknown member, a hidden guild row and a soft-removed row', async () => {
    const picker = await makeUser('l2notfound');
    expect((await claim(2_000_000_000, picker.token)).status).toBe(404);
    expect((await claim(memberId('Hidden Row'), picker.token)).status).toBe(
      404,
    );
    expect((await claim(memberId('Gone Away'), picker.token)).status).toBe(404);
    expect(await charactersNamed('Hidden Row')).toEqual([]);
    expect(await charactersNamed('Gone Away')).toEqual([]);
  });

  it('400s a body without a selectable ruleset', async () => {
    const picker = await makeUser('l2badbody');
    expect((await claim(memberId('Gone Away'), picker.token, {})).status).toBe(
      400,
    );
    const hc = await claim(memberId('Gone Away'), picker.token, {
      ruleset: 'hardcore',
    });
    expect(hc.status).toBe(400);
  });

  it('requires a session (401)', async () => {
    const res = await testApp.request
      .post(`/plugins/wow/roster-claim/members/${memberId('Gone Away')}/claim`)
      .send(BODY);
    expect(res.status).toBe(401);
  });
});

describe('roster claim: locked re-check of the read (ROK-2128 review 1)', () => {
  it('409s when the row is renamed between the read and the locks; nothing is inserted', async () => {
    const picker = await makeUser('l2stale');
    const id = await insertMember(guildId, {
      characterName: 'Stale Read',
      guid: 'G-L2-STALE',
    });
    const stale = await readMember(testApp.db, id);
    // A LedgerLink apply / Blizzard sync renames the row before the claim locks.
    await testApp.db
      .update(schema.guildMembers)
      .set({ characterName: 'Fresh Name' })
      .where(eq(schema.guildMembers.id, id));
    const run = testApp.db.transaction((tx) =>
      claimWithin(tx, stale, {
        userId: picker.id,
        memberId: id,
        ruleset: 'normal',
        isMain: false,
      }),
    );
    await expect(run).rejects.toThrow(ROSTER_ROW_CHANGED);
    expect(await charactersNamed('Stale Read')).toEqual([]);
    expect(await charactersNamed('Fresh Name')).toEqual([]);
  });
});
