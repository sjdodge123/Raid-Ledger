/**
 * ROK-1953 L3 — `GET /hubs/:guildId/steam-stats` against a real database
 * (I1–I9) and the DEMO_MODE seed. Written by L3, run on the fleet.
 * I7's WoW-hub arm is pinned at unit level (`enabledAppId`, kind not in
 * the list) — a WoW fixture row needs realm/roster columns this spec does
 * not otherwise touch.
 */
import { eq } from 'drizzle-orm';
import {
  SteamHubStatsResponseSchema,
  type SteamHubStatsResponse,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../guilds/hub-hidden.helpers';
import { SteamStatsStorageRepository } from './steam-stats-storage.repository';

const BG3 = 1086940;
const NOT_ENABLED = 892970;
const SECRET = 'ACH_SECRET';
const SECRET_NAME = 'Secret Ending';
let testApp: TestApp;

type Role = 'member' | 'admin';
interface Who {
  id: number;
  token: string;
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const url = (g: number) => `/hubs/${g}/steam-stats`;

async function makeUser(
  name: string,
  steamId: string | null,
  role: Role = 'member',
): Promise<Who> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, steamId, role })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  const token = await signTestAccessToken(testApp, {
    sub: u.id,
    username: name,
  });
  return { id: u.id, token };
}

async function makeGame(slug: string, steamAppId: number | null) {
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: slug, slug, steamAppId })
      .returning({ id: schema.games.id }),
    `game ${slug}`,
  );
  return g.id;
}

async function makeHub(gameId: number, name: string): Promise<number> {
  const [h] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      })
      .returning({ id: schema.guilds.id }),
    `hub ${name}`,
  );
  return h.id;
}

async function join(guildId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.hubCommunityMembers)
    .values({ guildId, userId, role: 'member' });
}

async function seedApp(): Promise<void> {
  await testApp.db.insert(schema.steamAppStatsApps).values({
    appId: BG3,
    achievementCount: 3,
    schemaStatus: 'ok',
    schemaFetchedAt: new Date('2026-10-24T04:30:00Z'),
  });
  await testApp.db.insert(schema.steamAppAchievements).values([
    {
      appId: BG3,
      apiName: 'ACH_ONE',
      name: 'Act One',
      hidden: false,
      globalPct: '70.000',
    },
    {
      appId: BG3,
      apiName: 'ACH_TWO',
      name: 'Act Two',
      hidden: false,
      globalPct: '40.000',
    },
    {
      appId: BG3,
      apiName: SECRET,
      name: SECRET_NAME,
      description: 'Spoiler',
      hidden: true,
      globalPct: '2.500',
    },
  ]);
}

async function stats(
  userId: number,
  status: 'ok' | 'private',
  unlocks: Record<string, string | null>,
): Promise<void> {
  const n = Object.keys(unlocks).length;
  await testApp.db.insert(schema.steamUserAppStats).values({
    userId,
    appId: BG3,
    status,
    unlockedCount: status === 'ok' ? n : null,
  });
  if (n === 0) return;
  await testApp.db.insert(schema.steamUserAchievements).values(
    Object.entries(unlocks).map(([apiName, at]) => ({
      userId,
      appId: BG3,
      apiName,
      unlockedAt: at === null ? null : new Date(at),
    })),
  );
}

async function playtime(
  userId: number,
  gameId: number,
  source: string,
  minutes: number,
) {
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source, playtimeForever: minutes });
}

async function read(g: number, who: Who): Promise<SteamHubStatsResponse> {
  const res = await testApp.request.get(url(g)).set(auth(who.token));
  expect({ status: res.status, cache: res.headers['cache-control'] }).toEqual({
    status: 200,
    cache: 'private, no-store',
  });
  return SteamHubStatsResponseSchema.parse(res.body);
}

function available(r: SteamHubStatsResponse) {
  if (!r.available) throw new Error('expected available: true');
  return r;
}

let gameId: number;
let hub: number;
let a: Who; // ok, unlocked the hidden achievement
let b: Who; // ok, never unlocked it
let c: Who; // private
let d: Who; // unlinked, with kept rows

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  gameId = await makeGame('bg3-read', BG3);
  hub = await makeHub(gameId, 'Read Crew');
  await seedApp();
  a = await makeUser('astarion', '76561190000000101');
  b = await makeUser('bea', '76561190000000102');
  c = await makeUser('cal', '76561190000000103');
  d = await makeUser('dee', null);
  for (const u of [a, b, c, d]) await join(hub, u.id);
  await stats(a.id, 'ok', {
    ACH_ONE: '2026-10-20T10:00:00Z',
    [SECRET]: '2026-10-22T10:00:00Z',
  });
  await stats(b.id, 'ok', { ACH_TWO: '2026-10-21T10:00:00Z' });
  await stats(c.id, 'private', {});
  await stats(d.id, 'ok', { ACH_TWO: '2026-10-23T10:00:00Z' });
});

describe('GET /hubs/:guildId/steam-stats — masking (I1, I2, I4)', () => {
  it("I1 — B sees A's hidden unlock masked; the raw JSON carries no api name or name", async () => {
    const res = await testApp.request.get(url(hub)).set(auth(b.token));
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect({
      apiName: raw.includes(SECRET),
      name: raw.includes(SECRET_NAME),
      spoiler: raw.includes('Spoiler'),
    }).toEqual({ apiName: false, name: false, spoiler: false });
    const body = available(SteamHubStatsResponseSchema.parse(res.body));
    const aSecret = body.recentUnlocks.find(
      (u) => u.userId === a.id && u.unlockedAt === '2026-10-22T10:00:00.000Z',
    );
    expect(aSecret?.achievement).toEqual({ masked: true, globalPct: 2.5 });
    expect(body.rarestUnlock).toEqual({
      userId: a.id,
      unlockedAt: '2026-10-22T10:00:00.000Z',
      achievement: { masked: true, globalPct: 2.5 },
    });
  });

  it('I2 — A (who unlocked it) sees its name', async () => {
    const body = available(await read(hub, a));
    expect(body.rarestUnlock?.achievement).toMatchObject({
      masked: false,
      apiName: SECRET,
      name: SECRET_NAME,
      hidden: true,
    });
  });

  it('I4 — an admin who is not a member gets 200 and is still masked', async () => {
    const admin = await makeUser('root', null, 'admin');
    const res = await testApp.request.get(url(hub)).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body).includes(SECRET_NAME)).toBe(false);
    expect(
      available(SteamHubStatsResponseSchema.parse(res.body)).viewer,
    ).toEqual({ status: 'unlinked' });
  });
});

describe('GET /hubs/:guildId/steam-stats — gate (I3)', () => {
  it('I3 — non-member, hidden hub and missing hub share one 404 body; no JWT is 401', async () => {
    const stranger = await makeUser('stranger', '76561190000000199');
    const nonMember = await testApp.request
      .get(url(hub))
      .set(auth(stranger.token));
    const missing = await testApp.request
      .get(url(hub + 999))
      .set(auth(b.token));
    await testApp.db
      .update(schema.guilds)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.guilds.id, hub));
    const hidden = await testApp.request.get(url(hub)).set(auth(b.token));
    for (const res of [nonMember, missing, hidden]) {
      expect({ status: res.status, message: res.body.message }).toEqual({
        status: 404,
        message: HUB_NOT_FOUND,
      });
    }
    expect(nonMember.body).toEqual(hidden.body);
    expect((await testApp.request.get(url(hub))).status).toBe(401);
  });

  it('a non-integer guild id is a 400', async () => {
    const res = await testApp.request
      .get('/hubs/abc/steam-stats')
      .set(auth(b.token));
    expect(res.status).toBe(400);
  });
});

describe('GET /hubs/:guildId/steam-stats — members + feeds (I5, I6, I8, I9)', () => {
  it('I5 — C is private with a null count; D is unlinked and absent from every feed', async () => {
    const body = available(await read(hub, b));
    const byId = new Map(body.members.map((m) => [m.userId, m]));
    expect([byId.get(c.id)?.status, byId.get(c.id)?.unlockedCount]).toEqual([
      'private',
      null,
    ]);
    expect([byId.get(d.id)?.status, byId.get(d.id)?.unlockedCount]).toEqual([
      'unlinked',
      null,
    ]);
    expect(body.recentUnlocks.map((u) => u.userId)).not.toContain(d.id);
    expect(body.rarestUnlock?.userId).not.toBe(d.id);
    expect(body.viewer).toEqual({ status: 'ok' });
  });

  it('I6 — playtime comes from steam_library for the hub game; a manual row is ignored', async () => {
    await playtime(a.id, gameId, 'steam_library', 1234);
    await playtime(b.id, gameId, 'manual', 999);
    const body = available(await read(hub, b));
    const byId = new Map(
      body.members.map((m) => [m.userId, m.playtimeMinutes]),
    );
    expect([byId.get(a.id), byId.get(b.id)]).toEqual([1234, null]);
  });

  it('I8 — a member who left is absent everywhere', async () => {
    await testApp.db
      .update(schema.hubCommunityMembers)
      .set({ leftAt: new Date() })
      .where(eq(schema.hubCommunityMembers.userId, a.id));
    const body = available(await read(hub, b));
    expect(body.members.map((m) => m.userId)).not.toContain(a.id);
    expect(body.recentUnlocks.map((u) => u.userId)).not.toContain(a.id);
    expect(body.rarestUnlock).not.toMatchObject({ userId: a.id });
  });

  it('I9 — members ordered by unlockedCount desc, nulls last, then name; NULL-time unlocks stay out of the feed', async () => {
    await testApp.db.insert(schema.steamUserAchievements).values({
      userId: b.id,
      appId: BG3,
      apiName: 'ACH_ONE',
      unlockedAt: null,
    });
    const body = available(await read(hub, b));
    expect(body.members.map((m) => m.displayName)).toEqual([
      'astarion',
      'bea',
      'cal',
      'dee',
    ]);
    expect(body.recentUnlocks.map((u) => u.unlockedAt)).toEqual([
      '2026-10-22T10:00:00.000Z',
      '2026-10-21T10:00:00.000Z',
      '2026-10-20T10:00:00.000Z',
    ]);
    expect([body.totalAchievements, body.refreshedAt]).toEqual([
      3,
      '2026-10-24T04:30:00.000Z',
    ]);
  });
});

describe('GET /hubs/:guildId/steam-stats — a failed schema fetch (review MAJOR 1)', () => {
  it('I10 — keeps the stored count and the last good refresh time', async () => {
    await testApp.app.get(SteamStatsStorageRepository).markSchemaError(BG3);
    const res = available(await read(hub, b));
    expect({
      total: res.totalAchievements,
      refreshedAt: res.refreshedAt,
    }).toEqual({ total: 3, refreshedAt: '2026-10-24T04:30:00.000Z' });
  });
});

describe('GET /hubs/:guildId/steam-stats — availability (I7)', () => {
  it('I7 — a hub whose game has an app id NOT on the list answers { available: false }', async () => {
    const other = await makeHub(
      await makeGame('other-game', NOT_ENABLED),
      'Other',
    );
    await join(other, b.id);
    expect(await read(other, b)).toEqual({ available: false });
  });

  it('I7 — a hub whose game has no app id answers { available: false }', async () => {
    const plain = await makeHub(await makeGame('no-app', null), 'Plain');
    await join(plain, b.id);
    expect(await read(plain, b)).toEqual({ available: false });
  });
});

describe('POST /admin/test/steam-app-stats/seed (DEMO_MODE)', () => {
  const ORIGINAL = process.env.DEMO_MODE;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL;
  });

  it('seeds A–D on a BG3 hub: B sees the hidden unlock masked, A sees it named', async () => {
    process.env.DEMO_MODE = 'true';
    const bg3 = await makeHub(
      await makeGame('baldurs-gate-3', null),
      'Seed Crew',
    );
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const seed = () =>
      testApp.request
        .post('/admin/test/steam-app-stats/seed')
        .set(auth(admin))
        .send({ guildId: bg3 });
    const res = await seed();
    expect(res.status).toBe(200);
    expect((await seed()).status).toBe(200); // idempotent re-seed
    const users = res.body.users as Record<
      'a' | 'b' | 'c' | 'd',
      { userId: number; username: string }
    >;
    const as = async (k: 'a' | 'b') => ({
      id: users[k].userId,
      token: await signTestAccessToken(testApp, {
        sub: users[k].userId,
        username: users[k].username,
      }),
    });
    const asB = available(await read(bg3, await as('b')));
    expect(JSON.stringify(asB).includes('Demo Secret')).toBe(false);
    expect(asB.rarestUnlock).toMatchObject({
      userId: users.a.userId,
      achievement: { masked: true, globalPct: 2.7 },
    });
    const status = new Map(asB.members.map((m) => [m.userId, m.status]));
    expect(
      [users.a, users.b, users.c, users.d].map((u) => status.get(u.userId)),
    ).toEqual(['ok', 'ok', 'private', 'unlinked']);
    const asA = available(await read(bg3, await as('a')));
    expect(asA.rarestUnlock?.achievement).toMatchObject({
      masked: false,
      name: 'Demo Secret Ending',
    });
  });

  it('refuses a hub whose game is not BG3 (400)', async () => {
    process.env.DEMO_MODE = 'true';
    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const other = await makeHub(await makeGame('valheim-x', null), 'Vikings');
    const res = await testApp.request
      .post('/admin/test/steam-app-stats/seed')
      .set(auth(admin))
      .send({ guildId: other });
    expect(res.status).toBe(400);
  });
});
