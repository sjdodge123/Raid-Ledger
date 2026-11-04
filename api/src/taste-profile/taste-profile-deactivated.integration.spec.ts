/**
 * Backlog 2816 — taste-profile + similar-players honour the ROK-1260
 * deactivated-user rule (and ROK-1371 banned/kicked) on real SQL.
 *
 * - A deactivated or banned user never appears in another member's
 *   similar-players list or co-play partners (ACTIVE_MEMBER_SQL_AND).
 * - GET /users/:id/taste-profile and /similar-players 404 for a deactivated
 *   target unless the viewer is an admin (mirrors UsersController).
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function seedVector(userId: number, vector: number[]): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO player_taste_vectors
      (user_id, vector, dimensions, intensity_metrics, signal_hash)
    VALUES (
      ${userId}, ${`[${vector.join(',')}]`}::vector, '{}'::jsonb,
      '{"intensity":50,"focus":50,"breadth":50,"consistency":50}'::jsonb,
      ${`h-${userId}`}
    )
  `);
}

async function seedCoPlay(a: number, b: number): Promise<void> {
  await testApp.db.execute(sql`
    INSERT INTO player_co_play
      (user_id_a, user_id_b, session_count, total_minutes, last_played_at, games_played)
    VALUES (${Math.min(a, b)}, ${Math.max(a, b)}, 3, 120, NOW(), '[]'::jsonb)
  `);
}

async function mark(userId: number, column: 'deactivated' | 'banned') {
  if (column === 'deactivated') {
    await testApp.db.execute(
      sql`UPDATE users SET deactivated_at = NOW() WHERE id = ${userId}`,
    );
  } else {
    await testApp.db.execute(
      sql`UPDATE users SET banned_at = NOW() WHERE id = ${userId}`,
    );
  }
}

interface World {
  anchor: number;
  activePeer: number;
  deactivatedPeer: number;
  bannedPeer: number;
  memberToken: string;
}

/** Anchor + three near-identical peers (one deactivated, one banned). */
async function seedWorld(): Promise<World> {
  const mk = (name: string) =>
    createMemberAndLogin(testApp, name, `${name}@test.local`);
  const anchor = (await mk('tp-anchor')).userId;
  const activePeer = (await mk('tp-active')).userId;
  const deactivatedPeer = (await mk('tp-deact')).userId;
  const bannedPeer = (await mk('tp-banned')).userId;
  const memberToken = (await mk('tp-viewer')).token;
  await seedVector(anchor, [1, 0, 0, 0, 0, 0, 0]);
  for (const peer of [activePeer, deactivatedPeer, bannedPeer]) {
    await seedVector(peer, [1, 0.1, 0, 0, 0, 0, 0]);
    await seedCoPlay(anchor, peer);
  }
  await mark(deactivatedPeer, 'deactivated');
  await mark(bannedPeer, 'banned');
  return { anchor, activePeer, deactivatedPeer, bannedPeer, memberToken };
}

function get(path: string, token: string) {
  return testApp.request.get(path).set('Authorization', `Bearer ${token}`);
}

/** userIds from a response list; a malformed row fails loudly as NaN. */
function ids(rows: unknown): number[] {
  if (!Array.isArray(rows)) throw new Error('expected an array of rows');
  return rows.map((r: unknown) =>
    typeof r === 'object' && r !== null && 'userId' in r
      ? Number(r.userId)
      : Number.NaN,
  );
}

describe('Backlog 2816 — inactive users hidden from taste-profile lists', () => {
  it('similar-players omits deactivated and banned peers, for member and admin', async () => {
    const w = await seedWorld();
    for (const token of [w.memberToken, adminToken]) {
      const res = await get(`/users/${w.anchor}/similar-players`, token);
      expect(res.status).toBe(200);
      const similar = ids(res.body.similar);
      expect(similar).toContain(w.activePeer);
      expect(similar).not.toContain(w.deactivatedPeer);
      expect(similar).not.toContain(w.bannedPeer);
    }
  });

  it('taste-profile co-play partners omit deactivated and banned peers', async () => {
    const w = await seedWorld();
    for (const token of [w.memberToken, adminToken]) {
      const res = await get(`/users/${w.anchor}/taste-profile`, token);
      expect(res.status).toBe(200);
      const partners = ids(res.body.coPlayPartners);
      expect(partners).toEqual([w.activePeer]);
    }
  });
});

describe('Backlog 2816 — deactivated target visibility (ROK-1260)', () => {
  const ROUTES = ['taste-profile', 'similar-players'] as const;

  it.each(ROUTES)(
    'GET /users/:id/%s 404s for a member viewing a deactivated user',
    async (route) => {
      const w = await seedWorld();
      const res = await get(
        `/users/${w.deactivatedPeer}/${route}`,
        w.memberToken,
      );
      expect(res.status).toBe(404);
    },
  );

  it.each(ROUTES)(
    'GET /users/:id/%s is 200 for an admin viewing a deactivated user',
    async (route) => {
      const w = await seedWorld();
      const res = await get(`/users/${w.deactivatedPeer}/${route}`, adminToken);
      expect(res.status).toBe(200);
    },
  );

  it.each(ROUTES)(
    'GET /users/:id/%s is 200 for a member viewing an active user',
    async (route) => {
      const w = await seedWorld();
      const res = await get(`/users/${w.activePeer}/${route}`, w.memberToken);
      expect(res.status).toBe(200);
    },
  );
});
