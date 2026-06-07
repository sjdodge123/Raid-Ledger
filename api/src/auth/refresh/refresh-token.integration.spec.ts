/**
 * ROK-1353 — refresh-token rotation + silent re-auth (integration, TDD).
 *
 * These tests prove the behavior the dev must build. They MUST FAIL against
 * the current `origin/main` state because none of the production code exists
 * yet:
 *   - the `refresh_tokens` table / Drizzle schema (`schema.refreshTokens`),
 *   - the `RefreshTokenService` (`./refresh-token.service`),
 *   - the `POST /auth/refresh` + `POST /auth/logout` endpoints,
 *   - the `rl_rt` httpOnly cookie issuance on `/auth/local` + Discord callback,
 *   - the `GET/PUT /admin/settings/session` admin endpoints,
 *   - the `revokeAllForUser` hook on the orchestrated deactivation path,
 *   - the access-JWT TTL drop to 1h + blocklist TTL 3600.
 *
 * The file imports `schema.refreshTokens` and `RefreshTokenService` directly,
 * so it COMPILE-FAILS until the dev adds them. Every runtime assertion is also
 * written to fail against current behavior (no cookie set, endpoints 404, etc.)
 * so the suite remains a true regression guard once it compiles.
 *
 * Covers ACs 2, 3, 4, 5, 6, 9 (AC1/7 are web-level — see the Playwright smoke
 * `scripts/smoke/auth-refresh.smoke.ts`).
 */
import * as crypto from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
// The refresh module does not exist yet — these imports compile-fail until the
// dev creates them. `RefreshTokenService` is the issue/rotate/revoke service;
// `REFRESH_COOKIE_NAME` is the `rl_rt` cookie name constant exported by the
// cookie helpers.
import { RefreshTokenService } from './refresh-token.service';
import { REFRESH_COOKIE_NAME } from './refresh-cookie.helpers';
import { DiscordNotificationService } from '../../notifications/discord-notification.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

/** Read all `set-cookie` header lines off a supertest response. */
function setCookieLines(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') return [raw];
  return [];
}

/** Extract the raw `rl_rt` cookie value from a response's set-cookie header. */
function extractRefreshCookie(res: {
  headers: Record<string, unknown>;
}): string | null {
  for (const line of setCookieLines(res)) {
    const match = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (match) return match[1];
  }
  return null;
}

/** Build the `Cookie` request header value for the `rl_rt` cookie. */
function cookieHeader(rawToken: string): string {
  return `${REFRESH_COOKIE_NAME}=${rawToken}`;
}

/** Log in the seeded admin via /auth/local and return the response. */
function loginLocal() {
  return testApp.request.post('/auth/local').send({
    email: testApp.seed.adminEmail,
    password: testApp.seed.adminPassword,
  });
}

function getRefreshService(): RefreshTokenService {
  return testApp.app.get(RefreshTokenService);
}

function getDiscordNotificationService(): DiscordNotificationService {
  return testApp.app.get(DiscordNotificationService);
}

/** Count un-revoked refresh-token rows for a user. */
/**
 * Age every consumed rotation for the user past the 60s race grace so a
 * replay reads as theft, not as a concurrent-tab race loser (ROK-1353).
 */
async function backdateRotations(userId: number): Promise<void> {
  await testApp.db
    .update(schema.refreshTokens)
    .set({ rotatedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(eq(schema.refreshTokens.userId, userId));
}

async function countActiveRefreshRows(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({
      id: schema.refreshTokens.id,
      revokedAt: schema.refreshTokens.revokedAt,
    })
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
  return rows.filter((r) => r.revokedAt === null).length;
}

async function createDiscordMember(username: string) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `discord-${username}`, username, role: 'member' })
    .returning();
  return user;
}

// ── AC9 — login issues an httpOnly cookie; DB stores hash only ───────────────

describe('Login mints a refresh cookie (AC9)', () => {
  it('sets an httpOnly rl_rt cookie on /auth/local and stores ONLY a hash', async () => {
    const res = await loginLocal();
    expect(res.status).toBe(200);

    const rawToken = extractRefreshCookie(res);
    expect(rawToken).toBeTruthy();

    // Cookie must be httpOnly so JS can never read it.
    const cookieLine = setCookieLines(res).find((l) =>
      l.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(cookieLine?.toLowerCase()).toContain('httponly');

    // The raw token MUST NOT appear in the JSON body.
    expect(JSON.stringify(res.body)).not.toContain(rawToken as string);

    // DB stores the SHA-256 hash, never the raw cookie value.
    const adminId = testApp.seed.adminUser.id;
    const [row] = await testApp.db
      .select({ tokenHash: schema.refreshTokens.tokenHash })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, adminId))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row.tokenHash).not.toBe(rawToken);
    const expectedHash = crypto
      .createHash('sha256')
      .update(rawToken as string)
      .digest('hex');
    expect(row.tokenHash).toBe(expectedHash);
  });
});

// ── AC2 — rotation + reuse-detection ─────────────────────────────────────────

describe('POST /auth/refresh rotation (AC2)', () => {
  it('rotates: returns a fresh access token and a new cookie', async () => {
    const login = await loginLocal();
    const oldCookie = extractRefreshCookie(login) as string;

    const refresh = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));

    expect(refresh.status).toBe(200);
    expect(refresh.body).toMatchObject({ access_token: expect.any(String) });

    const newCookie = extractRefreshCookie(refresh);
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldCookie);
  });

  it('invalidates the OLD token once past the race grace', async () => {
    const login = await loginLocal();
    const adminId = testApp.seed.adminUser.id;
    const oldCookie = extractRefreshCookie(login) as string;

    const first = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(first.status).toBe(200);

    // Outside the 60s concurrent-tab grace, replaying the consumed OLD
    // token must NOT mint a new access token.
    await backdateRotations(adminId);
    const replay = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(replay.status).not.toBe(200);
    expect(replay.body).not.toHaveProperty('access_token');
  });

  it('treats an immediate replay as a concurrent-tab race loser (sibling, no revoke)', async () => {
    const login = await loginLocal();
    const oldCookie = extractRefreshCookie(login) as string;
    const [parentRow] = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(
        eq(
          schema.refreshTokens.tokenHash,
          crypto.createHash('sha256').update(oldCookie).digest('hex'),
        ),
      )
      .limit(1);
    expect(parentRow).toBeTruthy();

    const winner = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(winner.status).toBe(200);

    // Same cookie again within the grace (e.g. browser session-restore with
    // multiple tabs): the loser gets a sibling token, the family survives.
    const loser = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(loser.status).toBe(200);
    expect(loser.body).toMatchObject({ access_token: expect.any(String) });

    // Both children remain live on the SAME family — no revocation happened.
    const familyRows = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.familyId, parentRow.familyId));
    const active = familyRows.filter((r) => !r.rotatedAt && !r.revokedAt);
    expect(active).toHaveLength(2);
    expect(familyRows.every((r) => !r.revokedAt)).toBe(true);
  });

  it('reuse of a consumed token revokes the WHOLE family', async () => {
    const login = await loginLocal();
    const adminId = testApp.seed.adminUser.id;
    const oldCookie = extractRefreshCookie(login) as string;

    // Rotate once → old token is consumed, child token is live.
    const rotated = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(rotated.status).toBe(200);
    const childCookie = extractRefreshCookie(rotated) as string;

    // Age the rotation past the race grace, then replay the consumed OLD
    // token → theft detected → family revoked.
    await backdateRotations(adminId);
    const reuse = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(oldCookie));
    expect(reuse.status).toBe(401);

    // Even the previously-valid CHILD token must now be dead (family revoked).
    const childAfter = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(childCookie));
    expect(childAfter.status).toBe(401);

    // No active refresh rows remain for the user.
    expect(await countActiveRefreshRows(adminId)).toBe(0);
  });
});

// ── AC3 — logout revokes family + clears cookie ──────────────────────────────

describe('POST /auth/logout (AC3)', () => {
  it('revokes the family server-side and clears the cookie', async () => {
    const login = await loginLocal();
    const adminId = testApp.seed.adminUser.id;
    const cookie = extractRefreshCookie(login) as string;

    const logout = await testApp.request
      .post('/auth/logout')
      .set('Cookie', cookieHeader(cookie));
    expect(logout.status).toBe(200);
    expect(logout.body).toMatchObject({ success: true });

    // The Set-Cookie on logout must clear rl_rt (empty value / Max-Age=0).
    const clearLine = setCookieLines(logout).find((l) =>
      l.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(clearLine).toBeTruthy();
    expect(clearLine?.toLowerCase()).toMatch(/max-age=0|expires=/);

    // Subsequent refresh with the same cookie → 401.
    const afterRefresh = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(cookie));
    expect(afterRefresh.status).toBe(401);

    // No active refresh rows remain.
    expect(await countActiveRefreshRows(adminId)).toBe(0);
  });
});

// ── AC4 — deactivation revokes ALL refresh tokens ────────────────────────────

describe('Deactivation revokes all refresh tokens (AC4)', () => {
  it('orchestrated deactivation revokes every active refresh row for the user', async () => {
    const member = await createDiscordMember('leaver');

    // Issue two distinct refresh families for the member (two logins / devices).
    const refreshService = getRefreshService();
    await refreshService.issue(member.id, { authMethod: 'discord' });
    await refreshService.issue(member.id, { authMethod: 'discord' });
    expect(await countActiveRefreshRows(member.id)).toBe(2);

    // Drive the REAL deactivation funnel (the orchestrated guild-leave path,
    // `deactivateUserOrchestrated`), not deleteUser.
    const notifications = getDiscordNotificationService();
    await notifications.deactivateUser(member.id);

    // Every refresh row for the user must now be revoked.
    expect(await countActiveRefreshRows(member.id)).toBe(0);
  });
});

// ── AC5 — session length is admin-configurable, honored on new logins ────────

describe('Session length setting (AC5)', () => {
  it('defaults to 60 days', async () => {
    const adminToken = (await loginLocal()).body.access_token as string;
    const res = await testApp.request
      .get('/admin/settings/session')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionLengthDays: 60 });
  });

  it('rejects out-of-range values (1–365)', async () => {
    const adminToken = (await loginLocal()).body.access_token as string;
    const res = await testApp.request
      .put('/admin/settings/session')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionLengthDays: 9999 });
    expect(res.status).toBe(400);
  });

  it('honors a configured TTL on new logins (cookie expiry ≈ setting)', async () => {
    const adminToken = (await loginLocal()).body.access_token as string;
    const put = await testApp.request
      .put('/admin/settings/session')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ sessionLengthDays: 7 });
    expect(put.status).toBe(200);

    const refreshService = getRefreshService();
    const adminId = testApp.seed.adminUser.id;
    const before = Date.now();
    await refreshService.issue(adminId, { authMethod: 'local' });

    // The /auth/local login above also minted a (60-day default) row; read the
    // NEWEST row so we assert against the post-PUT `issue` call, not the login.
    const [row] = await testApp.db
      .select({ expiresAt: schema.refreshTokens.expiresAt })
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, adminId))
      .orderBy(desc(schema.refreshTokens.createdAt))
      .limit(1);
    expect(row).toBeTruthy();
    const expiresMs = new Date(row.expiresAt).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    // Allow a generous skew window; the point is it tracks the 7-day setting,
    // not the 60-day default (which would be ~52 days larger).
    expect(expiresMs - before).toBeGreaterThan(sevenDaysMs - 60 * 60 * 1000);
    expect(expiresMs - before).toBeLessThan(sevenDaysMs + 60 * 60 * 1000);
  });

  it('GET /admin/settings/session requires admin auth', async () => {
    const res = await testApp.request.get('/admin/settings/session');
    expect(res.status).toBe(401);
  });
});

// ── AC6 — access JWT TTL is 1h ───────────────────────────────────────────────

describe('Access JWT TTL (AC6)', () => {
  it('issues a 1h access token on /auth/local', async () => {
    const res = await loginLocal();
    expect(res.status).toBe(200);
    const token = res.body.access_token as string;

    // Decode the JWT payload (no verification needed — we only read exp/iat).
    const [, payloadB64] = token.split('.');
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64').toString('utf8'),
    ) as { iat: number; exp: number };

    const ttlSeconds = payload.exp - payload.iat;
    // 1h = 3600s. Anything near 24h (86400) means the TTL drop wasn't applied.
    expect(ttlSeconds).toBe(3600);
  });
});

// ── AC2/expiry — expired refresh → 401 ───────────────────────────────────────

describe('Expired refresh token (AC2)', () => {
  it('returns 401 when the presented refresh row is already expired', async () => {
    const login = await loginLocal();
    const adminId = testApp.seed.adminUser.id;
    const cookie = extractRefreshCookie(login) as string;

    // Force-expire the stored row in the past.
    await testApp.db
      .update(schema.refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.refreshTokens.userId, adminId));

    const res = await testApp.request
      .post('/auth/refresh')
      .set('Cookie', cookieHeader(cookie));
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('access_token');
  });

  it('returns 401 when no refresh cookie is presented', async () => {
    const res = await testApp.request.post('/auth/refresh');
    expect(res.status).toBe(401);
  });
});
