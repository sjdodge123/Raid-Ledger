/**
 * ROK-1754 D1 — POST /admin/test/browser-session (integration, real DB).
 *
 * The DEMO_MODE-only endpoint the Playwright harness uses to give each
 * browser context its OWN refresh family: it sets `rl_rt` for the given
 * user, and `/auth/refresh` with that cookie mints that user's token.
 */
import { inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { defined } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { REFRESH_COOKIE_NAME } from '../auth/refresh/refresh-cookie.helpers';
import { SettingsService } from '../settings/settings.service';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/browser-session';

let testApp: TestApp;
let adminToken: string;

async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

/** Extract the raw `rl_rt` value from a response's set-cookie header. */
function refreshCookieOf(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw)
    ? (raw as string[])
    : [typeof raw === 'string' ? raw : ''];
  const re = new RegExp(`${REFRESH_COOKIE_NAME}=([^;]+)`);
  const line = lines.find((l) => re.test(l));
  if (!line) throw new Error(`no ${REFRESH_COOKIE_NAME} in set-cookie`);
  return defined(re.exec(line)?.[1], 'rl_rt value');
}

/** Decode the `sub` claim of an access JWT (no verification needed here). */
function subOf(accessToken: string): number {
  const payload = defined(accessToken.split('.')[1], 'jwt payload');
  const json = Buffer.from(payload, 'base64url').toString('utf8');
  return (JSON.parse(json) as { sub: number }).sub;
}

async function insertMember(username: string): Promise<number> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `discord-${username}`, username, role: 'member' })
    .returning();
  return defined(user, `inserted ${username}`).id;
}

function mint(userId: unknown, token = adminToken) {
  return testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${token}`)
    .send({ userId });
}

function refreshWith(rawToken: string) {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/browser-session — gates', () => {
  it('403 when the DEMO_MODE env is off', async () => {
    process.env.DEMO_MODE = 'false';
    const res = await mint(testApp.seed.adminUser.id);
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('403 when the DB demoMode flag is off', async () => {
    await testApp.app.get(SettingsService).setDemoMode(false);
    const res = await mint(testApp.seed.adminUser.id);
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('401 without a JWT', async () => {
    const res = await testApp.request.post(ROUTE).send({ userId: 1 });
    expect(res.status).toBe(401);
  });

  it('404 for an unknown user, 400 for a malformed userId', async () => {
    expect((await mint(999_999)).status).toBe(404);
    expect((await mint('abc')).status).toBe(400);
  });
});

describe('POST /admin/test/browser-session — DEMO_MODE on', () => {
  it('sets rl_rt for the given user; /auth/refresh mints THEIR token', async () => {
    const memberId = await insertMember('browser-session-member');
    const res = await mint(memberId);
    expect(res.status).toBe(204);
    const refresh = await refreshWith(refreshCookieOf(res));
    expect(refresh.status).toBe(200);
    const accessToken = (refresh.body as { access_token: string }).access_token;
    expect(subOf(accessToken)).toBe(memberId);
  });

  it('two calls → two distinct families, both refresh, neither revoked', async () => {
    const userId = testApp.seed.adminUser.id;
    const familiesNow = async () =>
      new Set(
        (await testApp.db.select().from(schema.refreshTokens)).map(
          (r) => r.familyId,
        ),
      );
    const before = await familiesNow();
    const first = refreshCookieOf(await mint(userId));
    const second = refreshCookieOf(await mint(userId));
    expect(second).not.toBe(first);
    const families = [...(await familiesNow())].filter((f) => !before.has(f));
    expect(families).toHaveLength(2);
    expect((await refreshWith(first)).status).toBe(200);
    expect((await refreshWith(second)).status).toBe(200);
    const after = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(inArray(schema.refreshTokens.familyId, families));
    expect(after.filter((r) => r.revokedAt !== null)).toEqual([]);
  });
});
