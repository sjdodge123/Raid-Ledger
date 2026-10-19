/**
 * ROK-1832 — per-group (hub) notification mute routes against a real DB:
 *
 *   POST   /guilds/:id/notification-mute   members only (403 otherwise, staff too)
 *   DELETE /guilds/:id/notification-mute   any caller, no 404 without a row
 *   GET    /notifications/hub-mutes        the viewer's muted groups
 *   GET    /guilds/:id                     viewer.notificationsMuted
 *
 * A WoW hub refuses a visitor's page with 403, so "no flag for a visitor" is
 * pinned in `hub.service.spec.ts`; here the staff non-member (leader rung)
 * proves the flag is omitted for anyone the mute POST would refuse.
 */
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { loginAsAdmin } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { MUTE_MEMBERS_ONLY } from './hub-notification-mute.controller';

const SNAP = new Date('2026-10-12T20:00:00.000Z');
const PW = 'TestPassword123!';
type Who = 'member' | 'outsider' | 'admin';

let testApp: TestApp;
let guildId: number;
let memberId: number;
const tokens: Partial<Record<Who, string>> = {};

function token(who: Who): string {
  const t = tokens[who];
  if (t === undefined) throw new Error(`no token for ${who}`);
  return t;
}

async function insertHub(name: string): Promise<number> {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
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

/** A local-login user; returns its id and stores its token. */
async function seedUser(who: 'member' | 'outsider'): Promise<number> {
  const email = `hubmute-${who}@hubmute.test`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: `hubmute-${who}` })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash(PW, 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: PW });
  tokens[who] = res.body.access_token as string;
  return user.id;
}

/** A character whose GUID is on the hub's live roster ⇒ a member. */
async function linkMember(userId: number): Promise<void> {
  const guid = 'Player-1-hubmute';
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: 'Hubmute',
    addonGuid: guid,
    role: 'dps',
    isMain: true,
  });
  await testApp.db.insert(schema.guildMembers).values({
    guildId,
    guid,
    characterName: 'Hubmute',
    rankIndex: 3,
    rankName: 'Rank 3',
    source: 'addon_import',
    lastSeenAt: SNAP,
  });
}

const url = (): string => `/guilds/${guildId}/notification-mute`;
const as = (who: Who) => ({ Authorization: `Bearer ${token(who)}` });
const mute = (who: Who) => testApp.request.post(url()).set(as(who));
const unmute = (who: Who) => testApp.request.delete(url()).set(as(who));
const get = (path: string, who: Who) => testApp.request.get(path).set(as(who));

const memberRows = () =>
  testApp.db
    .select()
    .from(schema.hubNotificationMutes)
    .where(
      and(
        eq(schema.hubNotificationMutes.guildId, guildId),
        eq(schema.hubNotificationMutes.userId, memberId),
      ),
    );

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  guildId = await insertHub('Mute Hub Wardens');
  memberId = await seedUser('member');
  await linkMember(memberId);
  await seedUser('outsider');
  tokens.admin = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  await testApp.db
    .delete(schema.hubNotificationMutes)
    .where(eq(schema.hubNotificationMutes.guildId, guildId));
});

describe('POST guilds/:id/notification-mute', () => {
  it('a member mutes idempotently — 200 twice, one row', async () => {
    const first = await mute('member');
    const second = await mute('member');
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ guildId, muted: true });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ guildId, muted: true });
    expect(await memberRows()).toHaveLength(1);
  });

  it.each(['outsider', 'admin'] as const)(
    'a non-member %s is refused with 403 (staff included)',
    async (who) => {
      const res = await mute(who);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe(MUTE_MEMBERS_ONLY);
    },
  );
});

describe('DELETE guilds/:id/notification-mute', () => {
  it('returns muted:false with no row to delete (no 404)', async () => {
    const res = await unmute('outsider');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ guildId, muted: false });
  });

  it('unmutes a muted member', async () => {
    await mute('member');
    expect((await unmute('member')).body).toEqual({ guildId, muted: false });
    expect(await memberRows()).toHaveLength(0);
  });
});

describe('GET notifications/hub-mutes', () => {
  it('lists the muted group with its game name', async () => {
    await mute('member');
    const res = await get('/notifications/hub-mutes', 'member');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({
        guildId,
        name: 'Mute Hub Wardens',
        kind: 'wow_guild',
        gameName: testApp.seed.game.name,
        mutedAt: expect.any(String),
      }),
    ]);
  });

  it('is empty for a caller with no mutes', async () => {
    const res = await get('/notifications/hub-mutes', 'outsider');
    expect(res.body).toEqual({ data: [] });
  });
});

describe('GET guilds/:id viewer.notificationsMuted', () => {
  it('is true for a muted member and false after unmute', async () => {
    await mute('member');
    const muted = await get(`/guilds/${guildId}`, 'member');
    expect(muted.status).toBe(200);
    expect(muted.body.viewer.notificationsMuted).toBe(true);
    await unmute('member');
    const open = await get(`/guilds/${guildId}`, 'member');
    expect(open.body.viewer.notificationsMuted).toBe(false);
  });

  it('is omitted for a staff non-member (leader rung, cannot mute)', async () => {
    const res = await get(`/guilds/${guildId}`, 'admin');
    expect(res.status).toBe(200);
    expect(res.body.viewer.notificationsMuted).toBeUndefined();
  });
});
