/**
 * ROK-1275 — integration coverage for NotDeactivatedGuard.
 *
 * Table-driven: each gated endpoint is hit with both a deactivated and an
 * active member token. Deactivated → 403 + `code: USER_DEACTIVATED`.
 * Active → anything other than 403 (the real handlers may 200/201/400/404
 * depending on whether the body/route params resolve, but they must NOT
 * be blocked by the deactivation gate).
 *
 * The spec exists to prove the guard is wired correctly. It deliberately
 * does NOT exercise full happy-path business logic — endpoint-specific
 * integration specs cover that.
 */
import { JwtService } from '@nestjs/jwt';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

let testApp: TestApp;

async function createMember(
  username: string,
  opts: { deactivated?: boolean } = {},
) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: 'member',
      deactivatedAt: opts.deactivated ? new Date() : null,
    })
    .returning();
  return user;
}

function signFor(user: { id: number; username: string }): string {
  const jwt = testApp.app.get(JwtService);
  return jwt.sign({ sub: user.id, username: user.username });
}

async function ensureCacheConsistent(userId: number, deactivated: boolean) {
  // After truncateAllTables clearAuthUserCache() runs, the JwtStrategy is
  // forced back to a DB read. waitFor guards against any cron handler
  // racing the insert visibility (none should, but it's cheap insurance).
  await waitFor(async () => {
    const [row] = await testApp.db
      .select({ deactivatedAt: schema.users.deactivatedAt })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const isDeactivated = row?.deactivatedAt != null;
    if (isDeactivated !== deactivated) {
      throw new Error(
        `expected user ${userId} deactivated=${deactivated}, got ${isDeactivated}`,
      );
    }
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Endpoint {
  name: string;
  method: 'post' | 'patch' | 'delete' | 'put';
  path: string;
  body?: unknown;
}

/**
 * One endpoint per gated controller — enough surface to prove the guard
 * is wired and the 403 shape is consistent. Endpoint-specific specs
 * cover happy-path bodies. We pick handlers that don't require complex
 * cross-fixture setup (no real eventId/lineupId/matchId resolves), so
 * an active user reaches the handler and gets a 400/404 — anything
 * non-403 proves the guard let them through.
 */
const ENDPOINTS: Endpoint[] = [
  {
    name: 'events-signups: signup',
    method: 'post',
    path: '/events/999999/signup',
    body: {},
  },
  {
    name: 'events-signups: updateRoster',
    method: 'patch',
    path: '/events/999999/roster',
    body: { assignments: [] },
  },
  {
    name: 'events-pugs: createPug',
    method: 'post',
    path: '/events/999999/pugs',
    body: { role: 'dps' },
  },
  {
    name: 'events: create',
    method: 'post',
    path: '/events',
    body: {},
  },
  {
    name: 'events: update',
    method: 'patch',
    path: '/events/999999',
    body: {},
  },
  {
    name: 'events: cancel',
    method: 'patch',
    path: '/events/999999/cancel',
    body: {},
  },
  {
    name: 'events: delete',
    method: 'delete',
    path: '/events/999999',
  },
  {
    name: 'events-attendance: recordAttendance',
    method: 'patch',
    path: '/events/999999/attendance',
    body: {},
  },
  {
    name: 'event-plans: create',
    method: 'post',
    path: '/event-plans',
    body: {},
  },
  {
    name: 'invite: claim',
    method: 'post',
    path: '/invite/nonexistent-code/claim',
    body: {},
  },
  {
    name: 'lineups: vote',
    method: 'post',
    path: '/lineups/999999/vote',
    body: { gameId: 1 },
  },
  {
    name: 'lineups: nominate',
    method: 'post',
    path: '/lineups/999999/nominate',
    body: {},
  },
  {
    name: 'lineups: removeNomination',
    method: 'delete',
    path: '/lineups/999999/nominations/1',
  },
  {
    name: 'lineups: updateMetadata',
    method: 'patch',
    path: '/lineups/999999/metadata',
    body: {},
  },
  {
    name: 'lineups: joinMatch',
    method: 'post',
    path: '/lineups/999999/matches/1/join',
  },
  {
    name: 'tiebreaker: bracketVote',
    method: 'post',
    path: '/lineups/999999/tiebreaker/bracket-vote',
    body: {},
  },
  {
    name: 'tiebreaker: veto',
    method: 'post',
    path: '/lineups/999999/tiebreaker/veto',
    body: {},
  },
  {
    name: 'scheduling: suggest',
    method: 'post',
    path: '/lineups/999999/schedule/1/suggest',
    body: {},
  },
  {
    name: 'scheduling: vote',
    method: 'post',
    path: '/lineups/999999/schedule/1/vote',
    body: {},
  },
  {
    name: 'scheduling: retractVotes',
    method: 'delete',
    path: '/lineups/999999/schedule/1/votes',
  },
  {
    name: 'standalone-poll: create',
    method: 'post',
    path: '/scheduling-polls',
    body: {},
  },
  {
    name: 'standalone-poll: complete',
    method: 'post',
    path: '/scheduling-polls/1/complete',
    body: {},
  },
];

function sendWith(token: string, ep: Endpoint) {
  const req = testApp.request[ep.method](ep.path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return ep.body !== undefined ? req.send(ep.body as string | object) : req;
}

describe('NotDeactivatedGuard — integration (ROK-1275)', () => {
  describe.each(ENDPOINTS)('$method $path', (ep) => {
    it(`${ep.name}: deactivated user receives 403 USER_DEACTIVATED`, async () => {
      const user = await createMember(`deact-${ep.name.replace(/\W+/g, '-')}`, {
        deactivated: true,
      });
      await ensureCacheConsistent(user.id, true);
      const token = signFor(user);
      const res = await sendWith(token, ep);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: 'USER_DEACTIVATED' });
    });

    it(`${ep.name}: active user is NOT blocked by the gate`, async () => {
      const user = await createMember(`active-${ep.name.replace(/\W+/g, '-')}`);
      await ensureCacheConsistent(user.id, false);
      const token = signFor(user);
      const res = await sendWith(token, ep);
      // Active user must NOT trip the gate. The handler may still 400/
      // 404 because the fixture event/lineup/poll ID doesn't exist —
      // that's fine, we only assert the guard didn't reject.
      expect(res.status).not.toBe(403);
    });
  });

  it('impersonated deactivated user is allowed past the gate', async () => {
    const deactivated = await createMember('imp-target', { deactivated: true });
    const admin = testApp.seed.adminUser;
    const jwt = testApp.app.get(JwtService);
    const token = jwt.sign({
      sub: deactivated.id,
      username: deactivated.username,
      impersonatedBy: admin.id,
    });
    await ensureCacheConsistent(deactivated.id, true);

    const res = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).not.toBe(403);
  });
});
