/**
 * ROK-1732 — `CORS_ORIGIN=auto` is same-origin only (T4 / AC2, AC5).
 *
 * The integration harness (`test-app.ts`) wires the real `applyCorsPolicy`
 * before `app.init()`, and the policy reads `CORS_ORIGIN` / `CORS_AUTO_MODE`
 * per request, so each test flips the env and drives the spike §3.2 attack
 * path end to end: a sibling-subdomain page (`slot-1.gamernight.net`) POSTs
 * `/auth/refresh` to `raid.gamernight.net` with the victim's `rl_rt` cookie.
 *
 * - `report` (this release's default): allowed exactly as before (Origin
 *   reflected) AND one `[cors-auto] would-reject` line is logged.
 * - `enforce`: 403, no `Access-Control-Allow-Origin`, and the refresh token
 *   is NOT rotated — the handler never ran (a simple cross-origin POST needs
 *   no preflight, so withholding ACAO alone would not stop the rotation).
 */
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { REFRESH_COOKIE_NAME } from '../auth/refresh/refresh-cookie.helpers';

const APP_HOST = 'raid.gamernight.net';
const SAME_ORIGIN = `https://${APP_HOST}`;
const SIBLING_ORIGIN = 'https://slot-1.gamernight.net';

let testApp: TestApp;
let savedEnv: { corsOrigin?: string; autoMode?: string };

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(() => {
  savedEnv = {
    corsOrigin: process.env.CORS_ORIGIN,
    autoMode: process.env.CORS_AUTO_MODE,
  };
});

afterEach(async () => {
  restoreEnv('CORS_ORIGIN', savedEnv.corsOrigin);
  restoreEnv('CORS_AUTO_MODE', savedEnv.autoMode);
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function setAutoMode(mode: 'report' | 'enforce'): void {
  process.env.CORS_ORIGIN = 'auto';
  process.env.CORS_AUTO_MODE = mode;
}

/** Log in the seeded admin (no Origin → always allowed) and return rl_rt. */
async function loginAndGetRefreshCookie(): Promise<string> {
  const res = await testApp.request.post('/auth/local').send({
    email: testApp.seed.adminEmail,
    password: testApp.seed.adminPassword,
  });
  expect(res.status).toBe(200);
  const rawToken = extractRefreshCookie(res);
  if (!rawToken) throw new Error(`login set no ${REFRESH_COOKIE_NAME} cookie`);
  return rawToken;
}

function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string | null {
  const raw = res.headers['set-cookie'];
  const lines: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === 'string'
      ? [raw]
      : [];
  for (const line of lines) {
    const match = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (match?.[1]) return match[1];
  }
  return null;
}

/** POST /auth/refresh as the browser would: Host + optional Origin + cookie. */
function refresh(
  rawToken: string,
  headers: { origin?: string; xfh?: string } = {},
) {
  let req = testApp.request
    .post('/auth/refresh')
    .set('Host', APP_HOST)
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
  if (headers.origin) req = req.set('Origin', headers.origin);
  if (headers.xfh) req = req.set('X-Forwarded-Host', headers.xfh);
  return req;
}

/** The DB row for a raw refresh token (rotation stamps `rotatedAt`). */
async function refreshRow(rawToken: string) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const [row] = await testApp.db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.tokenHash, hash))
    .limit(1);
  return defined(row, 'refresh_tokens row for the login cookie');
}

function corsAutoWarnings(spy: jest.SpyInstance): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((msg) => msg.startsWith('[cors-auto] would-reject'));
}

/** Enforce-mode rejection: 403 body, no CORS grant, token untouched. */
async function expectRejectedWithoutRotation(
  res: Awaited<ReturnType<typeof refresh>>,
  rawToken: string,
): Promise<void> {
  expect(res.status).toBe(403);
  expect(res.body).toEqual({ statusCode: 403, message: 'Origin not allowed' });
  expect(res.headers['access-control-allow-origin']).toBeUndefined();
  expect(extractRefreshCookie(res)).toBeNull();
  const row = await refreshRow(rawToken);
  expect(row.rotatedAt).toBeNull();
  expect(row.revokedAt).toBeNull();
}

// ── report mode (this release's default) ─────────────────────────────────────

describe('CORS_ORIGIN=auto, CORS_AUTO_MODE=report (ROK-1732 AC2)', () => {
  it('allows a sibling-origin refresh as before and logs one would-reject line', async () => {
    setAutoMode('report');
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken, { origin: SIBLING_ORIGIN });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(SIBLING_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    const lines = corsAutoWarnings(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(
      `reason=host-mismatch origin=${SIBLING_ORIGIN} host=${APP_HOST}`,
    );
    expect(lines[0]).toContain('method=POST path=/auth/refresh');
    expect(lines[0]).not.toContain(rawToken);
  });
});

// ── enforce mode ─────────────────────────────────────────────────────────────

describe('CORS_ORIGIN=auto, CORS_AUTO_MODE=enforce — rejections (ROK-1732 AC2)', () => {
  it('rejects a sibling-origin refresh with 403 and never rotates the token', async () => {
    setAutoMode('enforce');
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken, { origin: SIBLING_ORIGIN });

    await expectRejectedWithoutRotation(res, rawToken);
    // The same cookie still works same-origin → the 403 consumed nothing.
    const followUp = await refresh(rawToken);
    expect(followUp.status).toBe(200);
  });

  it('ignores X-Forwarded-Host: a spoofed XFH matching the Origin is still rejected (AC5)', async () => {
    setAutoMode('enforce');
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken, {
      origin: SIBLING_ORIGIN,
      xfh: 'slot-1.gamernight.net',
    });

    await expectRejectedWithoutRotation(res, rawToken);
  });

  it('answers a sibling-origin preflight with 403 and no CORS grant', async () => {
    setAutoMode('enforce');

    const res = await testApp.request
      .options('/auth/refresh')
      .set('Host', APP_HOST)
      .set('Origin', SIBLING_ORIGIN)
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});

describe('CORS_ORIGIN=auto, CORS_AUTO_MODE=enforce — allowed (ROK-1732 AC2)', () => {
  it('allows a same-host Origin and reflects it', async () => {
    setAutoMode('enforce');
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken, { origin: SAME_ORIGIN });

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(SAME_ORIGIN);
    expect(extractRefreshCookie(res)).not.toBeNull();
    expect((await refreshRow(rawToken)).rotatedAt).not.toBeNull();
  });

  it('allows a request with no Origin (same-origin GET / non-browser client)', async () => {
    setAutoMode('enforce');
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken);

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect((await refreshRow(rawToken)).rotatedAt).not.toBeNull();
  });
});

// ── explicit CORS_ORIGIN (harness default http://localhost:5173) ─────────────

describe('explicit CORS_ORIGIN mismatch (ROK-1732 Q4)', () => {
  it('rejects an unlisted Origin with 403 (not 500) and never rotates the token', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:5173';
    const rawToken = await loginAndGetRefreshCookie();

    const res = await refresh(rawToken, { origin: 'https://evil.example' });

    await expectRejectedWithoutRotation(res, rawToken);
  });
});
