/**
 * ROK-2149 AC-1..AC-7 — `GET /plugins/wow/guilds/:id/members/:memberId`
 * against a real database. Two audiences (operator direction 2026-11-09
 * ~15:30Z): hub members + staff get the full read-only payload (rank, last
 * seen) or the claimed character's id; any other signed-in user gets the
 * payload WITHOUT rank / last seen, only for an unclaimed member of a
 * claimable WoW: Forever guild. Hidden hub → 404 for non-staff; another
 * guild's member or one not in the latest roster → 404; a snapshot whose
 * Blizzard id is not the member's → no Armory fields + `noArmoryReason`.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import {
  HUB_NOT_MEMBER,
  WowRosterMemberCharacterSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { loginAsAdmin } from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const STALE = new Date('2026-10-01T00:00:00Z');
const SYNCED = new Date('2026-11-02T12:00:00Z');
const memberUrl = (hub: number, member: number) =>
  `/plugins/wow/guilds/${hub}/members/${member}`;

let testApp: TestApp;
let foreverId: number;
let claimedCharacterId: string;
type HubKey = 'main' | 'other' | 'hidden' | 'retail';
type MemberKey =
  'verified' | 'mismatch' | 'claimed' | 'stale' | 'other' | 'hidden' | 'retail';
type TokenKey = 'member' | 'outsider' | 'admin';
const hubs: Partial<Record<HubKey, number>> = {};
const members: Partial<Record<MemberKey, number>> = {};
const tokens: Partial<Record<TokenKey, string>> = {};

/** A fixture `beforeAll` seeded — fails loudly by name if the seed never ran. */
function seeded<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`roster-member fixture not seeded: ${label}`);
  }
  return value;
}
const hub = (k: HubKey): number => seeded(hubs[k], `hub ${k}`);
const member = (k: MemberKey): number => seeded(members[k], `member ${k}`);
const token = (k: TokenKey): string => seeded(tokens[k], `token ${k}`);

async function ensureForever(): Promise<number> {
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

async function insertHub(
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
    'hub',
  );
  return g.id;
}

type MemberSeed = Partial<typeof schema.guildMembers.$inferInsert> & {
  characterName: string;
};

async function insertMember(guildId: number, row: MemberSeed) {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        source: 'addon_import',
        lastSeenAt: SNAPSHOT,
        ...row,
      })
      .returning({ id: schema.guildMembers.id }),
    `member ${row.characterName}`,
  );
  return m.id;
}

type ArmorySeed = Omit<
  typeof schema.guildMemberArmory.$inferInsert,
  'guildMemberId'
>;

async function insertArmory(guildMemberId: number, row: ArmorySeed) {
  await testApp.db
    .insert(schema.guildMemberArmory)
    .values({ guildMemberId, ...row });
}

/** A local-login member; returns its id and access token. */
async function makeUser(
  handle: string,
): Promise<{ id: number; token: string }> {
  const email = `${handle}@roster-member.test`;
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
  return { id: user.id, token: res.body.access_token as string };
}

/** A Forever character owned by `userId`, GUID-linked to a roster row. */
async function ownCharacter(userId: number, name: string, guid: string) {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: foreverId,
        name,
        region: 'us',
        addonGuid: guid,
      })
      .returning({ id: schema.characters.id }),
    `character ${name}`,
  );
  return c.id;
}

async function seedHubs(): Promise<void> {
  hubs.main = await insertHub('Roster Page Guild');
  hubs.other = await insertHub('Other Roster Guild');
  hubs.hidden = await insertHub('Hidden Roster Guild', { hiddenAt: SNAPSHOT });
  hubs.retail = await insertHub('Retail Roster Guild', {
    gameId: testApp.seed.game.id,
  });
}

async function seedMainMembers(): Promise<void> {
  const main = hub('main');
  await insertMember(main, { characterName: 'Rm Viewer', guid: 'G-RM-VIEW' });
  members.verified = await insertMember(main, {
    characterName: 'Verified Vale',
    guid: 'G-RM-VERIFIED',
    blizzardCharacterId: 3003,
    level: 40,
    class: 'Warrior',
    rankIndex: 2,
    rankName: 'Officer',
    onlineAtExport: false,
    lastOnlineDays: 3,
  });
  members.mismatch = await insertMember(main, {
    characterName: 'Mismatch Moor',
    blizzardCharacterId: 4004,
    level: 30,
    class: 'Mage',
  });
  members.claimed = await insertMember(main, {
    characterName: 'Claimed Crag',
    guid: 'G-RM-CLAIMED',
  });
  members.stale = await insertMember(main, {
    characterName: 'Stale Steppe',
    lastSeenAt: STALE,
  });
}

async function seedOtherMembers(): Promise<void> {
  members.other = await insertMember(hub('other'), {
    characterName: 'Elsewhere Elm',
  });
  members.hidden = await insertMember(hub('hidden'), {
    characterName: 'Hidden Hollow',
  });
  members.retail = await insertMember(hub('retail'), {
    characterName: 'Retail Reed',
  });
}

async function seedArmory(): Promise<void> {
  await insertArmory(member('verified'), {
    blizzardCharacterId: 3003,
    level: 42,
    class: 'Warrior',
    race: 'Human',
    spec: 'Arms',
    role: 'dps',
    itemLevel: 55,
    syncedAt: SYNCED,
  });
  // AC-4: a stored snapshot for a DIFFERENT Blizzard character.
  await insertArmory(member('mismatch'), {
    blizzardCharacterId: 5005,
    level: 60,
    class: 'Priest',
    race: 'Orc',
    spec: 'Shadow',
    role: 'dps',
    itemLevel: 70,
    syncedAt: SYNCED,
    lastError: 'id_mismatch',
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureForever();
  await seedHubs();
  await seedMainMembers();
  await seedOtherMembers();
  await seedArmory();
  const viewer = await makeUser('rmviewer');
  tokens.member = viewer.token;
  await ownCharacter(viewer.id, 'Rm Viewer', 'G-RM-VIEW');
  const claimer = await makeUser('rmclaimer');
  claimedCharacterId = await ownCharacter(
    claimer.id,
    'Claimed Crag',
    'G-RM-CLAIMED',
  );
  tokens.outsider = (await makeUser('rmoutsider')).token;
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const get = (hubId: number, memberId: number, auth?: string) => {
  const req = testApp.request.get(memberUrl(hubId, memberId));
  return auth === undefined ? req : req.set('Authorization', `Bearer ${auth}`);
};

/** AC-7: the strict contract schema rejects any key it does not declare. */
function expectStrictPayload(body: unknown): void {
  const parsed = WowRosterMemberCharacterSchema.safeParse(body);
  expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  expect(JSON.stringify(body)).not.toContain('linkedAccount');
}

describe('roster member — members + staff audience (AC-1, AC-6)', () => {
  it('a hub member gets the verified snapshot, rank and last seen', async () => {
    const res = await get(hub('main'), member('verified'), token('member'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: `roster-member:${member('verified')}`,
      userId: null,
      gameId: foreverId,
      name: 'Verified Vale',
      realm: null,
      class: 'Warrior',
      level: 42,
      race: 'Human',
      spec: 'Arms',
      role: 'dps',
      effectiveRole: 'dps',
      itemLevel: 55,
      lastSyncedAt: SYNCED.toISOString(),
      readOnly: true,
      rosterMemberId: member('verified'),
      hubId: hub('main'),
      canClaim: true,
      rank: { index: 2, name: 'Officer' },
      lastSeen: { online: false, lastOnlineDays: 3 },
    });
    expect(res.body).not.toHaveProperty('noArmoryReason');
    expectStrictPayload(res.body);
  });

  it('staff get the members payload too (rank present)', async () => {
    const res = await get(hub('main'), member('verified'), token('admin'));
    expect(res.status).toBe(200);
    expect(res.body.rank).toEqual({ index: 2, name: 'Officer' });
    expectStrictPayload(res.body);
  });

  it('a claimed member gives a hub member the claimed character id', async () => {
    const res = await get(hub('main'), member('claimed'), token('member'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      claimedCharacterId,
      rosterMemberId: member('claimed'),
      hubId: hub('main'),
    });
  });
});

describe('roster member — claim preview audience (non-member)', () => {
  it('an unclaimed member of a claimable Forever guild: no rank / lastSeen keys', async () => {
    const res = await get(hub('main'), member('verified'), token('outsider'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      rosterMemberId: member('verified'),
      race: 'Human',
      canClaim: true,
      readOnly: true,
    });
    expect(Object.keys(res.body)).not.toContain('rank');
    expect(Object.keys(res.body)).not.toContain('lastSeen');
    expectStrictPayload(res.body);
  });

  it('a claimed member → 403 (no redirect id leaks)', async () => {
    const res = await get(hub('main'), member('claimed'), token('outsider'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: HUB_NOT_MEMBER });
    expect(JSON.stringify(res.body)).not.toContain(claimedCharacterId);
  });

  it('a member of a non-Forever WoW guild → 403', async () => {
    const res = await get(hub('retail'), member('retail'), token('outsider'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: HUB_NOT_MEMBER });
  });
});

describe('roster member — refusals (AC-2, AC-3)', () => {
  it('401 without a session', async () => {
    expect((await get(hub('main'), member('verified'))).status).toBe(401);
  });

  it('a hidden hub → 404 for a non-staff viewer', async () => {
    const res = await get(hub('hidden'), member('hidden'), token('outsider'));
    expect(res.status).toBe(404);
  });

  it('a hidden hub → 200 for staff', async () => {
    const res = await get(hub('hidden'), member('hidden'), token('admin'));
    expect(res.status).toBe(200);
    expect(res.body.rosterMemberId).toBe(member('hidden'));
    // AC-6: a hidden hub is not claimable, so nobody is offered a claim.
    expect(res.body.canClaim).toBe(false);
    expect(res.body.noArmoryReason).toBe('no_blizzard_id');
    expectStrictPayload(res.body);
  });

  it.each([
    ['member', 'member'],
    ['non-member', 'outsider'],
  ] as const)('another guild’s member → 404 (%s)', async (_l, who) => {
    const res = await get(hub('main'), member('other'), token(who));
    expect(res.status).toBe(404);
  });

  it('a member not in the latest roster → 404', async () => {
    const res = await get(hub('main'), member('stale'), token('member'));
    expect(res.status).toBe(404);
  });
});

describe('roster member — unverified snapshot (AC-4)', () => {
  it('a snapshot of a different Blizzard id returns no Armory fields', async () => {
    const res = await get(hub('main'), member('mismatch'), token('member'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      class: 'Mage',
      level: 30,
      race: null,
      spec: null,
      role: null,
      effectiveRole: null,
      itemLevel: null,
      avatarUrl: null,
      equipment: null,
      talents: null,
      lastSyncedAt: null,
      noArmoryReason: 'id_mismatch',
    });
    expectStrictPayload(res.body);
  });
});
