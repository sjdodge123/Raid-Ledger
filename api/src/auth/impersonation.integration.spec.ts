/**
 * ROK-1754 part 1 — server-side impersonation: start / exit / audit / sweep.
 * Part 2 (refresh, logout, revocation, JwtStrategy) lives in
 * `impersonation-refresh.integration.spec.ts` (lane A2).
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { RefreshTokenService } from './refresh/refresh-token.service';
import { hashToken } from './refresh/refresh-token.helpers';
import { RefreshTokenCleanupService } from './refresh/refresh-token-cleanup.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

const markers = schema.refreshFamilyImpersonations;

/** Parse an audit row's JSON metadata. */
function meta(row: { metadata: string | null } | undefined): unknown {
  return JSON.parse(row?.metadata ?? 'null');
}

function decodeJwt(token: string): Record<string, unknown> {
  const part = defined(token.split('.')[1], 'jwt payload segment');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function rlRtFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  for (const line of lines) {
    const m = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (m?.[1]) return m[1];
  }
  throw new Error('login response set no rl_rt cookie');
}

const cookie = (raw: string) => `${REFRESH_COOKIE_NAME}=${raw}`;

/** Log in the seeded admin: bearer + its rl_rt cookie. */
async function loginAdmin() {
  const res = await testApp.request.post('/auth/local').send({
    email: testApp.seed.adminEmail,
    password: testApp.seed.adminPassword,
  });
  expect(res.status).toBe(200);
  return { token: res.body.access_token as string, rt: rlRtFrom(res) };
}

async function createUser(username: string, role: 'member' | 'operator') {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `discord-${username}`, username, role })
      .returning(),
    `inserted ${username}`,
  );
  return user;
}

function startImpersonation(targetId: number, token: string, rt?: string) {
  const req = testApp.request
    .post(`/auth/impersonate/${targetId}`)
    .set('Authorization', `Bearer ${token}`);
  return rt ? req.set('Cookie', cookie(rt)) : req;
}

async function auditRows(action: 'impersonate_start' | 'impersonate_stop') {
  return testApp.db
    .select()
    .from(schema.adminActions)
    .where(eq(schema.adminActions.action, action));
}

async function familyOf(rt: string): Promise<string> {
  const row = await testApp.app
    .get(RefreshTokenService)
    .findActiveByHash(hashToken(rt));
  if (!row) throw new Error('no refresh row for the login cookie');
  return row.familyId;
}

// ── start ────────────────────────────────────────────────────────────────────

describe('POST /auth/impersonate/:userId (ROK-1754)', () => {
  it('with the rl_rt cookie: writes the family marker + start audit, no original_token, exp = expires_at', async () => {
    const admin = await loginAdmin();
    const target = await createUser('imp-target', 'member');
    const res = await startImpersonation(target.id, admin.token, admin.rt);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['access_token', 'user']);
    expect(res.body.user).toMatchObject({ id: target.id });

    const familyId = await familyOf(admin.rt);
    const rows = await testApp.db.select().from(markers);
    expect(rows).toEqual([
      expect.objectContaining({
        familyId,
        impersonatorUserId: testApp.seed.adminUser.id,
        targetUserId: target.id,
      }),
    ]);
    const marker = defined(rows[0], 'marker');
    const claims = decodeJwt(res.body.access_token);
    expect(claims).toMatchObject({
      sub: target.id,
      impersonatedBy: testApp.seed.adminUser.id,
    });
    const expiresAtSec = Math.floor(marker.expiresAt.getTime() / 1000);
    expect(Math.abs(Number(claims.exp) - expiresAtSec)).toBeLessThanOrEqual(1);

    const starts = await auditRows('impersonate_start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      actorId: testApp.seed.adminUser.id,
      targetId: target.id,
    });
    expect(meta(starts[0])).toEqual({
      persistent: true,
      familyId,
    });
  });

  it('without a cookie: no marker, a 1h non-renewable token, audited persistent:false', async () => {
    const admin = await loginAdmin();
    const target = await createUser('imp-nocookie', 'member');
    const res = await startImpersonation(target.id, admin.token);
    expect(res.status).toBe(200);
    expect(await testApp.db.select().from(markers)).toEqual([]);
    const claims = decodeJwt(res.body.access_token);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
    const starts = await auditRows('impersonate_start');
    expect(meta(starts[0])).toEqual({
      persistent: false,
      familyId: null,
    });
  });

  it('403 session_mismatch when the cookie belongs to another user (no marker)', async () => {
    const admin = await loginAdmin();
    const other = await createUser('imp-other', 'member');
    const target = await createUser('imp-target2', 'member');
    const issued = await testApp.app
      .get(RefreshTokenService)
      .issue(other.id, { authMethod: 'local', userAgent: null });
    const res = await startImpersonation(
      target.id,
      admin.token,
      issued.rawToken,
    );
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 403,
      message: 'session_mismatch',
    });
    expect(await testApp.db.select().from(markers)).toEqual([]);
  });

  it('403 when an impersonated caller tries to impersonate again (no chaining)', async () => {
    const admin = await loginAdmin();
    const operator = await createUser('imp-operator', 'operator');
    const victim = await createUser('imp-victim', 'member');
    const first = await startImpersonation(operator.id, admin.token);
    expect(first.status).toBe(200);
    const chained = await startImpersonation(
      victim.id,
      first.body.access_token,
    );
    expect({ status: chained.status, message: chained.body.message }).toEqual({
      status: 403,
      message: 'Cannot impersonate while impersonating',
    });
  });

  it('403 when impersonating yourself', async () => {
    const admin = await loginAdmin();
    const res = await startImpersonation(
      testApp.seed.adminUser.id,
      admin.token,
    );
    expect(res.status).toBe(403);
  });
});

// ── exit ─────────────────────────────────────────────────────────────────────

describe('POST /auth/impersonate/exit (ROK-1754)', () => {
  it('reaches its own handler, not impersonate/:userId (route-order pin)', async () => {
    const admin = await loginAdmin();
    const res = await testApp.request
      .post('/auth/impersonate/exit')
      .set('Cookie', cookie(admin.rt));
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { success: true },
    });
  });

  it('ends the marker, is idempotent, and audits the stop exactly once', async () => {
    const admin = await loginAdmin();
    const target = await createUser('imp-exit', 'member');
    expect(
      (await startImpersonation(target.id, admin.token, admin.rt)).status,
    ).toBe(200);
    for (let i = 0; i < 2; i++) {
      const res = await testApp.request
        .post('/auth/impersonate/exit')
        .set('Cookie', cookie(admin.rt));
      expect({ status: res.status, body: res.body }).toEqual({
        status: 200,
        body: { success: true },
      });
    }
    expect(await testApp.db.select().from(markers)).toEqual([]);
    const stops = await auditRows('impersonate_stop');
    expect(stops).toHaveLength(1);
    expect(meta(stops[0])).toMatchObject({
      reason: 'user_exit',
    });
  });
});

// ── audit readers + cron ─────────────────────────────────────────────────────

describe('impersonation audit rows (ROK-1754)', () => {
  it('moderation history excludes impersonation rows', async () => {
    const admin = await loginAdmin();
    const target = await createUser('imp-history', 'member');
    await testApp.db.insert(schema.adminActions).values({
      action: 'kick',
      actorId: testApp.seed.adminUser.id,
      targetId: target.id,
    });
    expect(
      (await startImpersonation(target.id, admin.token, admin.rt)).status,
    ).toBe(200);
    await testApp.request
      .post('/auth/impersonate/exit')
      .set('Cookie', cookie(admin.rt));
    expect(await auditRows('impersonate_stop')).toHaveLength(1);

    const res = await testApp.request
      .get(`/users/${target.id}/admin-actions`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: { action: string }[];
      meta: { total: number };
    };
    expect({
      actions: body.data.map((r) => r.action),
      total: body.meta.total,
    }).toEqual({ actions: ['kick'], total: 1 });
  });

  it('the cleanup cron deletes expired markers and audits each as expired', async () => {
    const target = await createUser('imp-expired', 'member');
    const live = await createUser('imp-live', 'member');
    const adminId = testApp.seed.adminUser.id;
    const past = new Date(Date.now() - 60_000);
    await testApp.db.insert(markers).values([
      {
        familyId: '00000000-0000-4000-8000-000000000001',
        impersonatorUserId: adminId,
        targetUserId: target.id,
        startedAt: new Date(past.getTime() - 3_600_000),
        expiresAt: past,
      },
      {
        familyId: '00000000-0000-4000-8000-000000000002',
        impersonatorUserId: adminId,
        targetUserId: live.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ]);
    await testApp.app.get(RefreshTokenCleanupService).cleanupExpiredTokens();

    const left = await testApp.db.select().from(markers);
    expect(left.map((r) => r.targetUserId)).toEqual([live.id]);
    const stops = await auditRows('impersonate_stop');
    expect(
      stops.map((r) => [r.targetId, (meta(r) as { reason?: string }).reason]),
    ).toEqual([[target.id, 'expired']]);
  });
});
