/**
 * ROK-1810 — changing the admin password revokes every existing session
 * (refresh families + access JWTs) and re-issues the caller's own session.
 * Real DB; Redis is the standard in-memory REDIS_CLIENT mock from
 * `getTestApp` (the `jwt_block:` keys live there). The old `rl_rt` and old
 * access JWT must get 401 while the new cookie and access token keep working.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined } from '../common/testing/narrow';
import { REFRESH_COOKIE_NAME } from '../auth/refresh/refresh-cookie.helpers';

const NEW_PASSWORD = 'BrandNewPassword123!';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  // Also clears the `jwt_block:<adminId>` key this suite writes.
  testApp.seed = await truncateAllTables(testApp.db);
});

function setCookieLines(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') return [raw];
  return [];
}

function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string | undefined {
  for (const line of setCookieLines(res)) {
    const match = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (match) return defined(match[1], `${REFRESH_COOKIE_NAME} cookie value`);
  }
  return undefined;
}

/** Log in the seeded admin; returns its access JWT + raw `rl_rt` value. */
async function loginAdmin(password: string) {
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: testApp.seed.adminEmail, password });
  expect(res.status).toBe(200);
  const body = res.body as { access_token?: unknown };
  expect(typeof body.access_token).toBe('string');
  return {
    accessToken: String(body.access_token),
    refreshCookie: defined(extractRefreshCookie(res), 'login rl_rt cookie'),
  };
}

function changePassword(accessToken: string, currentPassword: string) {
  return testApp.request
    .post('/admin/onboarding/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ currentPassword, newPassword: NEW_PASSWORD });
}

function refreshWith(rawToken: string) {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

function adminStatus(accessToken: string) {
  return testApp.request
    .get('/admin/onboarding/status')
    .set('Authorization', `Bearer ${accessToken}`);
}

describe('ROK-1810 — POST /admin/onboarding/change-password revokes sessions', () => {
  it('kills the old rl_rt and access JWT and hands the caller a working new session', async () => {
    const attacker = await loginAdmin(testApp.seed.adminPassword);
    const caller = await loginAdmin(testApp.seed.adminPassword);

    const res = await changePassword(
      caller.accessToken,
      testApp.seed.adminPassword,
    );
    expect(res.status).toBe(200);
    const body = res.body as { success?: unknown; access_token?: unknown };
    expect(body.success).toBe(true);
    expect(typeof body.access_token).toBe('string');
    const newAccess = String(body.access_token);
    const newCookie = defined(
      extractRefreshCookie(res),
      're-issued rl_rt cookie',
    );
    expect(newCookie).not.toBe(caller.refreshCookie);

    // Every pre-change session is dead — the attacker's and the caller's own.
    expect((await refreshWith(attacker.refreshCookie)).status).toBe(401);
    expect((await refreshWith(caller.refreshCookie)).status).toBe(401);
    expect((await adminStatus(attacker.accessToken)).status).toBe(401);
    expect((await adminStatus(caller.accessToken)).status).toBe(401);

    // The re-issued session works, even within the same second as the block.
    expect((await adminStatus(newAccess)).status).toBe(200);
    expect((await refreshWith(newCookie)).status).toBe(200);
  });

  it('the new password logs in after the change', async () => {
    const caller = await loginAdmin(testApp.seed.adminPassword);
    expect(
      (await changePassword(caller.accessToken, testApp.seed.adminPassword))
        .status,
    ).toBe(200);
    await loginAdmin(NEW_PASSWORD);
  });

  it('a wrong current password revokes nothing', async () => {
    const caller = await loginAdmin(testApp.seed.adminPassword);
    const res = await changePassword(caller.accessToken, 'not-the-password');
    expect(res.status).toBe(401);
    expect(extractRefreshCookie(res)).toBeUndefined();
    expect((await adminStatus(caller.accessToken)).status).toBe(200);
    expect((await refreshWith(caller.refreshCookie)).status).toBe(200);
  });
});
