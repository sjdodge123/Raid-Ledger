/**
 * ROK-2132 AC 10 — `GET /plugins/wow/guilds/:id/join-gate` against a real
 * database: 401 signed out; one identical 404 for hidden (non-staff),
 * archived, unknown, non-Forever and non-WoW hubs; 200 with exactly the
 * Ruling 1 fields for a claimable Forever hub; `viewer.isMember` and
 * `viewer.hasForeverCharacter`; a deactivated caller refused by the JWT
 * strategy.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const SNAPSHOT = new Date('2026-11-01T00:00:00Z');
const gateUrl = (id: number) => `/plugins/wow/guilds/${id}/join-gate`;
const NOT_FOUND = {
  statusCode: 404,
  error: 'Not Found',
  message: 'Guild not found',
};

let testApp: TestApp;
let foreverId: number;
let gateId: number;
type HubKey = 'hidden' | 'archived' | 'retail' | 'crew';
type TokenKey = 'outsider' | 'player' | 'member';
const ids: Partial<Record<HubKey, number>> = {};
const tokens: Partial<Record<TokenKey, string>> = {};

/** A fixture `beforeAll` seeded — fails loudly by name if the seed never ran. */
function seeded<T>(value: T | undefined, label: string): T {
  if (value === undefined)
    throw new Error(`join-gate fixture not seeded: ${label}`);
  return value;
}
const hubId = (k: HubKey): number => seeded(ids[k], k);
const token = (k: TokenKey): string => seeded(tokens[k], k);

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

/** A local-login member; returns its id and access token. */
async function makeUser(
  handle: string,
): Promise<{ id: number; token: string }> {
  const email = `${handle}@join-gate.test`;
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

async function ownForeverCharacter(userId: number, name: string, guid: string) {
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: foreverId,
    name,
    region: 'us',
    addonGuid: guid,
  });
}

async function seedHubs(): Promise<void> {
  gateId = await insertHub('Gate Keepers', { rawRealm: 'Doomhowl' });
  ids.hidden = await insertHub('Hidden Gate', { hiddenAt: SNAPSHOT });
  ids.archived = await insertHub('Archived Gate', { archivedAt: SNAPSHOT });
  ids.retail = await insertHub('Retail Gate', { gameId: testApp.seed.game.id });
  ids.crew = await insertHub('Forever Crew', {
    kind: 'game_community',
    source: 'community',
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId: gateId,
    guid: 'G-GATE-MEMBER',
    characterName: 'Gate Member',
    source: 'addon_import',
    lastSeenAt: SNAPSHOT,
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureForever();
  await seedHubs();
  tokens.outsider = (await makeUser('gateoutsider')).token;
  const player = await makeUser('gateplayer');
  tokens.player = player.token;
  await ownForeverCharacter(player.id, 'Not On Roster', 'G-GATE-ELSEWHERE');
  const member = await makeUser('gatemember');
  tokens.member = member.token;
  await ownForeverCharacter(member.id, 'Gate Member', 'G-GATE-MEMBER');
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

const gate = (id: number, auth?: string) => {
  const req = testApp.request.get(gateUrl(id));
  return auth === undefined ? req : req.set('Authorization', `Bearer ${auth}`);
};

describe('GET /plugins/wow/guilds/:id/join-gate — 200 (ROK-2132)', () => {
  it('a non-member gets exactly the Ruling 1 fields', async () => {
    const res = await gate(gateId, token('outsider'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      guild: {
        id: gateId,
        gameId: foreverId,
        name: 'Gate Keepers',
        region: 'us',
        realmName: 'Doomhowl',
        memberCount: 0,
        crest: null,
      },
      viewer: { isMember: false, hasForeverCharacter: false },
    });
  });

  it('hasForeverCharacter is true for an owner of a Forever character', async () => {
    const res = await gate(gateId, token('player'));
    expect(res.status).toBe(200);
    expect(res.body.viewer).toEqual({
      isMember: false,
      hasForeverCharacter: true,
    });
  });

  it('isMember is true for a linked member', async () => {
    const res = await gate(gateId, token('member'));
    expect(res.status).toBe(200);
    expect(res.body.viewer).toEqual({
      isMember: true,
      hasForeverCharacter: true,
    });
  });
});

describe('GET /plugins/wow/guilds/:id/join-gate — refusals (ROK-2132)', () => {
  it('401 without a session', async () => {
    expect((await gate(gateId)).status).toBe(401);
  });

  it.each([
    ['hidden (non-staff)', () => hubId('hidden')],
    ['archived', () => hubId('archived')],
    ['unknown', () => 999999],
    ['non-Forever WoW guild', () => hubId('retail')],
    ['non-WoW hub of the Forever game', () => hubId('crew')],
  ])('%s → the same 404 body', async (_label, id) => {
    const res = await gate(id(), token('outsider'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual(NOT_FOUND);
  });

  it('a deactivated caller is refused by the JWT strategy (401)', async () => {
    const gone = await makeUser('gatedeactivated');
    await testApp.db
      .update(schema.users)
      .set({ deactivatedAt: new Date() })
      .where(eq(schema.users.id, gone.id));
    expect((await gate(gateId, gone.token)).status).toBe(401);
  });
});
