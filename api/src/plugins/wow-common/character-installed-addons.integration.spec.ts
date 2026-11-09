/**
 * ROK-2147 §5 / AC5 — `GET /plugins/wow/characters/:id/installed-addons`
 * against a real database: the owner and an officer (`canEdit`: a granted
 * editor, and staff) of the character's guild see the list; a plain member,
 * a non-member and a hidden hub's officer get `{ visible: false, installed:
 * null }` with no list in the body; anonymous is 401; no export yet is
 * `installed: null` for someone who may see it.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import type { AddonInstalled } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { loginAsAdmin } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

const SNAP = new Date('2026-11-08T20:00:00.000Z');
const CAPTURED = new Date('2026-11-08T18:30:00.000Z');

type Who = 'owner' | 'officer' | 'plain' | 'outsider';
type Actor = Who | 'admin';

let testApp: TestApp;
let guildId: number;
const tokens = {} as Record<Actor, string>;
const chars = {} as Record<Who, string>;

const NOT_VISIBLE = { visible: false, installed: null };
const DETAILS = {
  name: 'Details',
  title: 'Details! Damage Meter',
  version: '1.2',
  loaded: true,
};
const STORED: AddonInstalled[] = [
  DETAILS,
  { name: 'WeakAuras', loaded: false },
];
const VISIBLE = {
  visible: true,
  installed: {
    addons: [
      DETAILS,
      { name: 'WeakAuras', title: null, version: null, loaded: false },
    ],
    capturedAt: CAPTURED.toISOString(),
  },
};

async function insertGuild(): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        kind: 'wow_guild',
        region: 'us',
        name: 'Installed Keepers',
        nameKey: 'installed keepers',
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning(),
    'guild',
  );
  return g.id;
}

async function addMember(guid: string, name: string): Promise<number> {
  const [member] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        characterName: name,
        rankIndex: 3,
        rankName: 'Rank 3',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning(),
    'member',
  );
  return member.id;
}

/** A local-login user with one character; a guild member unless an outsider. */
async function seedUser(who: Who): Promise<number | null> {
  const email = `${who}@installed-addons.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `inst-${who}`,
        role: 'member',
      })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const guid = `Player-1-inst-${who}`;
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId: user.id,
        gameId: testApp.seed.game.id,
        name: `inst${who}`,
        addonGuid: guid,
        role: 'dps',
        isMain: true,
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  chars[who] = c.id;
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  tokens[who] = res.body.access_token as string;
  return who === 'outsider' ? null : addMember(guid, `inst${who}`);
}

const path = (id: string) => `/plugins/wow/characters/${id}/installed-addons`;
const get = (who: Actor, id = chars.owner) =>
  testApp.request.get(path(id)).set('Authorization', `Bearer ${tokens[who]}`);

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertGuild();
  await seedUser('owner');
  const officerMember = await seedUser('officer');
  await seedUser('plain');
  await seedUser('outsider');
  await testApp.db
    .insert(schema.guildEditors)
    .values({ guildId, kind: 'member', guildMemberId: officerMember });
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
  await testApp.db.insert(schema.characterInstalledAddons).values({
    characterId: chars.owner,
    addons: STORED,
    capturedAt: CAPTURED,
    payloadSha256: 'a'.repeat(64),
  });
});

/** Randomized order: every test starts with the hub visible. */
beforeEach(async () => {
  await testApp.db
    .update(schema.guilds)
    .set({ hiddenAt: null })
    .where(eq(schema.guilds.id, guildId));
});

describe('GET installed-addons — who sees the list (AC5)', () => {
  it('the owner sees the stored list', async () => {
    const res = await get('owner');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(VISIBLE);
  });

  it('a granted officer and staff (canEdit) see the list', async () => {
    expect((await get('officer')).body).toEqual(VISIBLE);
    expect((await get('admin')).body).toEqual(VISIBLE);
  });

  it('a plain member and a non-member get not-visible with no list', async () => {
    for (const who of ['plain', 'outsider'] as const) {
      const res = await get(who);
      expect({ who, status: res.status, body: res.body }).toEqual({
        who,
        status: 200,
        body: NOT_VISIBLE,
      });
    }
  });

  it('anonymous is 401; a malformed id is 400', async () => {
    expect((await testApp.request.get(path(chars.owner))).status).toBe(401);
    expect((await get('owner', 'not-a-uuid')).status).toBe(400);
  });

  it('an unknown character is not-visible, even for staff', async () => {
    const res = await get('admin', '00000000-0000-4000-8000-000000000000');
    expect(res.body).toEqual(NOT_VISIBLE);
  });

  it('a hidden hub hides it from its officer, not from the owner or staff', async () => {
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, guildId));
    expect((await get('officer')).body).toEqual(NOT_VISIBLE);
    expect((await get('owner')).body).toEqual(VISIBLE);
    expect((await get('admin')).body).toEqual(VISIBLE);
  });
});

describe('GET installed-addons — no export yet', () => {
  it('is visible with installed null for the owner and an officer', async () => {
    const empty = { visible: true, installed: null };
    expect((await get('plain', chars.plain)).body).toEqual(empty);
    expect((await get('officer', chars.plain)).body).toEqual(empty);
    expect((await get('owner', chars.plain)).body).toEqual(NOT_VISIBLE);
  });
});
