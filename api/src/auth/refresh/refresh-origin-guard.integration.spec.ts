/**
 * ROK-1755 — `/auth/refresh` + `/auth/logout` reject cross-site callers with
 * 403 and touch nothing, in BOTH `CORS_AUTO_MODE`s (report lets every Origin
 * through the CORS gate, so this guard is the only layer there). Same-origin
 * and header-less requests are unchanged. Also: the 10 s race grace mints ONE
 * sibling per parent; later in-window replays are 409 `refresh_raced` (no
 * revoke, no blocklist); only a replay older than the window is reuse.
 */
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { defined } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { REFRESH_COOKIE_NAME } from './refresh-cookie.helpers';
import { CROSS_SITE_REJECTED_MESSAGE } from './same-origin-cookie-post.guard';
import { RACE_GRACE_MS } from './refresh-grace.helpers';
import { readTokenVersion } from '../token-version.helpers';

const APP_HOST = 'raid.gamernight.net';
const SAME_ORIGIN = `https://${APP_HOST}`;
const SIBLING_ORIGIN = 'https://slot-1.gamernight.net';
const SIBLING = { origin: SIBLING_ORIGIN, site: 'same-site' };

let testApp: TestApp;
let saved: { corsOrigin?: string | undefined; autoMode?: string | undefined };

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  saved = {
    corsOrigin: process.env.CORS_ORIGIN,
    autoMode: process.env.CORS_AUTO_MODE,
  };
});

afterEach(async () => {
  restoreEnv('CORS_ORIGIN', saved.corsOrigin);
  restoreEnv('CORS_AUTO_MODE', saved.autoMode);
  testApp.seed = await truncateAllTables(testApp.db);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string | null {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? [raw]
      : [];
  for (const line of lines) {
    const match = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (match?.[1]) return match[1];
  }
  return null;
}

async function login(): Promise<string> {
  const res = await testApp.request.post('/auth/local').send({
    email: testApp.seed.adminEmail,
    password: testApp.seed.adminPassword,
  });
  expect(res.status).toBe(200);
  return cookieOf(res);
}

function cookieOf(res: { headers: Record<string, unknown> }): string {
  const cookie = extractRefreshCookie(res);
  if (!cookie) throw new Error(`response set no ${REFRESH_COOKIE_NAME}`);
  return cookie;
}

type Headers = { origin?: string; site?: string };

function post(path: string, rawToken: string, headers: Headers = {}) {
  let req = testApp.request
    .post(path)
    .set('Host', APP_HOST)
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
  if (headers.origin) req = req.set('Origin', headers.origin);
  if (headers.site) req = req.set('Sec-Fetch-Site', headers.site);
  return req;
}

async function rowFor(rawToken: string) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const [row] = await testApp.db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hash))
    .limit(1);
  return defined(row, 'refresh_tokens row');
}

async function expectUntouched(rawToken: string): Promise<void> {
  const row = await rowFor(rawToken);
  expect({ rotatedAt: row.rotatedAt, revokedAt: row.revokedAt }).toEqual({
    rotatedAt: null,
    revokedAt: null,
  });
}

describe.each(['report', 'enforce'] as const)(
  'refresh/logout origin guard — CORS_AUTO_MODE=%s',
  (mode) => {
    beforeEach(() => {
      process.env.CORS_ORIGIN = 'auto';
      process.env.CORS_AUTO_MODE = mode;
    });

    it('refresh with Sec-Fetch-Site: cross-site → 403, no rotation', async () => {
      const token = await login();
      const res = await post('/auth/refresh', token, { site: 'cross-site' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ message: CROSS_SITE_REJECTED_MESSAGE });
      expect(res.body).not.toHaveProperty('access_token');
      await expectUntouched(token);
    });

    it('refresh from a mismatched sibling Origin → 403, no rotation', async () => {
      const token = await login();
      const res = await post('/auth/refresh', token, SIBLING);
      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty('access_token');
      // Report mode: the CORS gate only logs, so the guard is what said no.
      if (mode === 'report') {
        expect(res.body).toMatchObject({
          message: CROSS_SITE_REJECTED_MESSAGE,
        });
      }
      await expectUntouched(token);
    });

    it('logout with Sec-Fetch-Site: cross-site → 403, family NOT revoked', async () => {
      const token = await login();
      const res = await post('/auth/logout', token, { site: 'cross-site' });
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ message: CROSS_SITE_REJECTED_MESSAGE });
      await expectUntouched(token);
    });

    it('logout from a mismatched Origin → 403, family NOT revoked', async () => {
      const token = await login();
      const res = await post('/auth/logout', token, { origin: SIBLING_ORIGIN });
      expect(res.status).toBe(403);
      await expectUntouched(token);
    });

    it('same-origin refresh → 200 and rotates', async () => {
      const token = await login();
      const res = await post('/auth/refresh', token, {
        origin: SAME_ORIGIN,
        site: 'same-origin',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ access_token: expect.any(String) });
      expect((await rowFor(token)).rotatedAt).not.toBeNull();
    });

    it('header-less refresh + logout (non-browser client) unchanged', async () => {
      const token = await login();
      const res = await post('/auth/refresh', token);
      expect(res.status).toBe(200);
      const child = cookieOf(res);
      const out = await post('/auth/logout', child);
      expect(out.status).toBe(200);
      expect((await rowFor(child)).revokedAt).not.toBeNull();
    });
  },
);

async function familyRevocations(familyId: string) {
  return testApp.db
    .select({ revokedAt: schema.refreshTokens.revokedAt })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.familyId, familyId));
}

/** The admin's token version (ROK-1823: reuse bumps it; a race must not). */
function adminVersion(): Promise<number> {
  return readTokenVersion(testApp.db, testApp.seed.adminUser.id);
}

describe('refresh race grace — one sibling per parent (ROK-1755)', () => {
  it('3 concurrent refreshes on one cookie → rotation + one sibling + 409, family live, token version unchanged', async () => {
    const token = await login();
    const familyId = (await rowFor(token)).familyId;
    const before = await adminVersion();

    const results = await Promise.all(
      [0, 1, 2].map(() => post('/auth/refresh', token)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 409]);
    const raced = results.filter((r) => r.status === 409);
    for (const res of raced) {
      expect(res.body).toMatchObject({
        statusCode: 409,
        code: 'refresh_raced',
      });
      expect(res.body).not.toHaveProperty('access_token');
      expect(extractRefreshCookie(res)).toBeNull();
    }

    const family = await familyRevocations(familyId);
    expect(family.length).toBe(3); // parent + winner child + one sibling
    expect(family.filter((r) => r.revokedAt !== null)).toEqual([]);
    expect(await adminVersion()).toBe(before);
  });

  it('a sequential third in-window replay is raced (409), not reuse', async () => {
    const token = await login();
    const familyId = (await rowFor(token)).familyId;
    const before = await adminVersion();
    expect((await post('/auth/refresh', token)).status).toBe(200);
    expect((await post('/auth/refresh', token)).status).toBe(200);

    const replay = await post('/auth/refresh', token);
    expect(replay.status).toBe(409);
    expect(replay.body).toMatchObject({ code: 'refresh_raced' });
    expect(replay.body).not.toHaveProperty('access_token');
    const family = await familyRevocations(familyId);
    expect(family.filter((r) => r.revokedAt !== null)).toEqual([]);
    expect(await adminVersion()).toBe(before);
  });

  it('a replay older than the window is reuse → family revoked + token version bumped', async () => {
    const token = await login();
    const familyId = (await rowFor(token)).familyId;
    const before = await adminVersion();
    expect((await post('/auth/refresh', token)).status).toBe(200);
    await testApp.db
      .update(schema.refreshTokens)
      .set({ rotatedAt: new Date(Date.now() - RACE_GRACE_MS - 5_000) })
      .where(eq(schema.refreshTokens.familyId, familyId));

    const replay = await post('/auth/refresh', token);
    expect(replay.status).toBe(401);
    expect(replay.body).not.toHaveProperty('access_token');
    const family = await familyRevocations(familyId);
    expect(family.length).toBe(2);
    expect(family.filter((r) => r.revokedAt === null)).toEqual([]);
    expect(await adminVersion()).toBe(before + 1);
  });
});
