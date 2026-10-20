/**
 * ROK-1753 — a deactivated user's session is rejected at the JWT strategy
 * (every guarded route, not just the NotDeactivatedGuard controllers) and on
 * POST /auth/refresh (no rotation). Reactivation resumes the SAME tokens.
 *
 * ROK-1764 — a bearer JWT whose `sub` is not a positive integer (e.g. the
 * deferred-signup intent token, signed with the same secret) is a 401, not a
 * 500 from the users lookup.
 */
import { JwtService } from '@nestjs/jwt';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from './auth-user-cache';
import { IntentTokenService } from './intent-token.service';
import { RefreshTokenService } from './refresh/refresh-token.service';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

async function createMember(username: string) {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${username}@test.local`, username })
      .returning(),
    `inserted member ${username}`,
  );
  return user;
}

/** Flip deactivated_at the way the sweep does: DB write, then cache bust. */
async function setDeactivated(userId: number, on: boolean): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: on ? new Date() : null })
    .where(eq(schema.users.id, userId));
  invalidateAuthUser(userId);
}

function bearer(user: { id: number; username: string }): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
  });
}

async function issueRefresh(userId: number): Promise<string> {
  const issued = await testApp.app
    .get(RefreshTokenService)
    .issue(userId, { authMethod: 'local' });
  return issued.rawToken;
}

function refresh(rawToken: string) {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

async function refreshRows(userId: number) {
  return testApp.db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
}

/** Two guarded routes outside the 17 NotDeactivatedGuard controllers. */
const GUARDED = [
  { name: 'character write', method: 'post', path: '/users/me/characters' },
  { name: 'lineup read', method: 'get', path: '/lineups/999999/suggestions' },
  { name: 'auth/me', method: 'get', path: '/auth/me' },
] as const;

function hit(token: string, route: (typeof GUARDED)[number]) {
  const req = testApp.request[route.method](route.path).set(
    'Authorization',
    `Bearer ${token}`,
  );
  return route.method === 'post' ? req.send({}) : req;
}

describe('ROK-1753 — deactivated access JWT is rejected by JwtStrategy', () => {
  it.each(GUARDED)('$name → 401 USER_DEACTIVATED', async (route) => {
    const user = await createMember(`deact-${route.method}`);
    const token = await bearer(user);
    await setDeactivated(user.id, true);

    const res = await hit(token, route);

    expect({ status: res.status, code: res.body?.code }).toEqual({
      status: 401,
      code: 'USER_DEACTIVATED',
    });
  });

  it('reactivation resumes the SAME access token', async () => {
    const user = await createMember('react-access');
    const token = await bearer(user);
    await setDeactivated(user.id, true);
    expect((await hit(token, defined(GUARDED[2], 'me'))).status).toBe(401);

    await setDeactivated(user.id, false);
    const res = await hit(token, defined(GUARDED[2], 'me'));

    expect(res.status).toBe(200);
  });

  it('an admin impersonating a deactivated user is still let through', async () => {
    const user = await createMember('imp-deact');
    await setDeactivated(user.id, true);
    const token = await signTestAccessToken(testApp, {
      sub: user.id,
      username: user.username,
      impersonatedBy: testApp.seed.adminUser.id,
    });

    const res = await hit(token, defined(GUARDED[2], 'me'));

    expect(res.status).toBe(200);
  });
});

describe('ROK-1753 — POST /auth/refresh for a deactivated user', () => {
  it('rejects with 401 USER_DEACTIVATED and does NOT rotate the token', async () => {
    const user = await createMember('deact-refresh');
    const raw = await issueRefresh(user.id);
    await setDeactivated(user.id, true);

    const res = await refresh(raw);

    expect({ status: res.status, code: res.body?.code }).toEqual({
      status: 401,
      code: 'USER_DEACTIVATED',
    });
    expect(res.body).not.toHaveProperty('access_token');
    const rows = await refreshRows(user.id);
    expect(rows.map((r) => [r.rotatedAt, r.revokedAt])).toEqual([[null, null]]);
  });

  it('reactivation resumes the SAME refresh token', async () => {
    const user = await createMember('react-refresh');
    const raw = await issueRefresh(user.id);
    await setDeactivated(user.id, true);
    expect((await refresh(raw)).status).toBe(401);

    await setDeactivated(user.id, false);
    const res = await refresh(raw);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access_token: expect.any(String) });
  });
});

describe('ROK-1753 — a banned (hence also deactivated) user keeps the ban path', () => {
  /** Mirror banUserById + the ban orchestration: ban stamps BOTH columns,
   *  drops the auth cache, then revokes every refresh family. */
  async function banAndDeactivate(userId: number): Promise<void> {
    await testApp.db
      .update(schema.users)
      .set({
        bannedAt: new Date(),
        banReason: 'griefing',
        deactivatedAt: new Date(),
      })
      .where(eq(schema.users.id, userId));
    invalidateAuthUser(userId);
    await testApp.app.get(RefreshTokenService).revokeAllForUser(userId);
  }

  it('refresh is the pre-ROK-1753 revoked-token 401, NOT USER_DEACTIVATED', async () => {
    const user = await createMember('banned-refresh');
    const raw = await issueRefresh(user.id);
    await banAndDeactivate(user.id);

    const res = await refresh(raw);

    expect({
      status: res.status,
      code: res.body?.code,
      message: res.body?.message,
    }).toEqual({
      status: 401,
      code: undefined,
      message: 'Invalid refresh token',
    });
  });

  it('the access JWT gets the suspended reason, NOT USER_DEACTIVATED', async () => {
    const user = await createMember('banned-bearer');
    const token = await bearer(user);
    await banAndDeactivate(user.id);

    const res = await hit(token, defined(GUARDED[2], 'me'));

    expect({
      status: res.status,
      code: res.body?.code,
      message: res.body?.message,
    }).toEqual({
      status: 401,
      code: undefined,
      message: 'Your account has been suspended: griefing',
    });
  });
});

describe('ROK-1764 — a bearer JWT without a numeric sub is a 401', () => {
  it('rejects a deferred-signup intent token presented as a bearer', async () => {
    const intent = testApp.app.get(IntentTokenService).generate(1, '123456');

    const res = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${intent}`);

    expect(res.status).toBe(401);
  });

  it.each([
    ['"42"', '42'],
    ['a word', 'abc'],
    ['zero', 0],
    ['a float', 1.5],
  ])('rejects a sub that is %s', async (_label, sub) => {
    // `tv: 0` keeps the version claim well-formed, so only the bad sub can 401.
    const token = testApp.app
      .get(JwtService)
      .sign({ sub, username: 'x', tv: 0 });

    const res = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
  });
});
