/**
 * ROK-1734 — the user-identity read routes project per viewer, on real DB data.
 *
 * `GET /users`, `/users/recent`, `/users/:id/profile`, `/games/:id/activity`
 * and `/games/:id/now-playing`: anonymous and signed-in-deactivated callers
 * get NO `discordId` / `discordUserId` / `discordAvatarHash` / `steamId` key at
 * ANY depth (recursive key walk, not spot checks) and a server-built avatar
 * URL; signed-in members and admins keep today's payload. `steamId` is never
 * on the profile for a non-owner viewer (Q1).
 *
 * The linked user appears on every route (asserted), so an empty payload
 * cannot pass the key walk vacuously.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { clearAuthUserCache } from '../auth/auth-user-cache';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

const LINKED_SNOWFLAKE = '123456789012345678';
const LINKED_HASH = 'abcdef';
const STEAM_ID = '76561190000000001';
const CDN_URL = `https://cdn.discordapp.com/avatars/${LINKED_SNOWFLAKE}/${LINKED_HASH}.png`;
const FORBIDDEN = new Set([
  'discordId',
  'discordUserId',
  'discordAvatarHash',
  'steamId',
]);

let testApp: TestApp;
let adminToken: string;

/** Every JSON path whose key is an identity field, at any depth. */
function forbiddenPaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value))
    return value.flatMap((v, i) => forbiddenPaths(v, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(FORBIDDEN.has(k) ? [`${path}.${k}`] : []),
    ...forbiddenPaths(v, `${path}.${k}`),
  ]);
}

interface Fixture {
  gameId: number;
  linkedUserId: number;
  memberToken: string;
  deactivatedToken: string;
}

/** A rollup (for /activity) and an open session (for /now-playing). */
async function seedPlaytime(userId: number, gameId: number) {
  await testApp.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'day',
    periodStart: new Date().toISOString().slice(0, 10),
    totalSeconds: 3600,
  });
  await testApp.db.insert(schema.gameActivitySessions).values({
    userId,
    gameId,
    discordActivityName: 'Seeded Game',
  });
}

/** Linked user (real snowflake + hash + Steam id) and a `local:` player. */
async function seedPlayers(gameId: number): Promise<number> {
  const linked = await createMemberAndLogin(testApp, 'linked', 'li@test.local');
  await testApp.db
    .update(schema.users)
    .set({
      discordId: LINKED_SNOWFLAKE,
      avatar: LINKED_HASH,
      steamId: STEAM_ID,
    })
    .where(eq(schema.users.id, linked.userId));
  await seedPlaytime(linked.userId, gameId);
  const local = await createMemberAndLogin(testApp, 'localp', 'lp@test.local');
  await seedPlaytime(local.userId, gameId);
  return linked.userId;
}

async function seedFixture(): Promise<Fixture> {
  const gameId = testApp.seed.game.id;
  const linkedUserId = await seedPlayers(gameId);
  const member = await createMemberAndLogin(testApp, 'mem', 'mem@test.local');
  const deact = await createMemberAndLogin(testApp, 'gone', 'gone@test.local');
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: new Date() })
    .where(eq(schema.users.id, deact.userId));
  clearAuthUserCache();
  return {
    gameId,
    linkedUserId,
    memberToken: member.token,
    deactivatedToken: deact.token,
  };
}

type Row = { username: string; avatar: string | null; discordId?: unknown };
type Route = { url: string; rows: (body: unknown) => Row[] };

function routes(f: Fixture): Route[] {
  const pick = (key: string) => (b: unknown) =>
    (b as Record<string, Row[]>)[key] ?? [];
  return [
    { url: '/users', rows: pick('data') },
    { url: '/users/recent', rows: pick('data') },
    {
      url: `/users/${f.linkedUserId}/profile`,
      rows: (b) => [(b as { data: Row }).data],
    },
    { url: `/games/${f.gameId}/activity?period=all`, rows: pick('topPlayers') },
    { url: `/games/${f.gameId}/now-playing`, rows: pick('players') },
  ];
}

async function get(url: string, token?: string) {
  const req = testApp.request.get(url);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

function linkedRow(route: Route, body: unknown): Row | undefined {
  return route.rows(body).find((r) => r.username === 'linked');
}

describe('ROK-1734 user-identity route projection (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(async () => {
    f = await seedFixture();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    clearAuthUserCache();
  });

  it.each([
    ['anonymous', false],
    ['signed-in deactivated', true],
  ] as const)(
    'a %s caller gets no identity key anywhere and a server-built avatar',
    async (_label, deactivated) => {
      const token = deactivated ? f.deactivatedToken : undefined;
      for (const route of routes(f)) {
        const res = await get(route.url, token);
        expect({ url: route.url, status: res.status }).toEqual({
          url: route.url,
          status: 200,
        });
        expect({ url: route.url, paths: forbiddenPaths(res.body) }).toEqual({
          url: route.url,
          paths: [],
        });
        expect({
          url: route.url,
          avatar: linkedRow(route, res.body)?.avatar,
        }).toEqual({ url: route.url, avatar: CDN_URL });
      }
    },
  );

  it('anonymous: a local: player with no Discord avatar gets null', async () => {
    const res = await get(`/games/${f.gameId}/now-playing`);
    const players = (res.body as { players: Row[] }).players;
    const local = players.find((p) => p.username === 'localp');
    expect({ found: !!local, avatar: local?.avatar }).toEqual({
      found: true,
      avatar: null,
    });
  });

  it.each([
    ['member', () => f.memberToken],
    ['admin', () => adminToken],
  ] as const)(
    'a signed-in %s keeps the member shape (raw hash + discordId)',
    async (_label, token) => {
      for (const route of routes(f)) {
        const res = await get(route.url, token());
        expect({ url: route.url, status: res.status }).toEqual({
          url: route.url,
          status: 200,
        });
        const row = linkedRow(route, res.body);
        expect({
          url: route.url,
          discordId: row?.discordId,
          avatar: row?.avatar,
        }).toEqual({
          url: route.url,
          discordId: LINKED_SNOWFLAKE,
          avatar: LINKED_HASH,
        });
      }
    },
  );

  it.each([
    ['anonymous', (): string | undefined => undefined],
    ['member', (): string | undefined => f.memberToken],
    ['admin', (): string | undefined => adminToken],
    ['deactivated', (): string | undefined => f.deactivatedToken],
  ] as const)(
    'Q1: the profile never carries steamId for a %s viewer',
    async (_label, token) => {
      const res = await get(`/users/${f.linkedUserId}/profile`, token());
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('steamId');
      expect(res.body.data.steamLinked).toBe(true);
    },
  );
});
