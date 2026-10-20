/**
 * ROK-1823 I6 + I7 — the token version under concurrency and impersonation.
 *
 * I6: a refresh in flight across a password change must never leave a usable
 * session at the OLD version — a token it minted before the bump commits is
 * dead the moment it commits, and its child rl_rt is revoked by the same tx.
 * I7: an impersonation token carries `tv` (target) and `itv` (impersonator);
 * either one moving kills it, and marker expiry still drops back to the
 * holder's own token. Real DB, real HTTP.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import {
  currentTokenVersion,
  signTestAccessToken,
} from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from './auth-user-cache';
import { ImpersonationSessionService } from './impersonation/impersonation-session.service';
import { PasswordChangeSessionService } from './password-change/password-change-session.service';
import * as mint from './refresh/refresh-access-token.helpers';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { RefreshTokenService } from './refresh/refresh-token.service';
import { bumpTokenVersion } from './token-version.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

type Res = { status: number; body: unknown; headers: Record<string, unknown> };
type Role = 'member' | 'operator' | 'admin';

const tv = (userId: number) => currentTokenVersion(testApp.db, userId);

async function createUser(username: string, role: Role) {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `discord-${username}`, username, role })
      .returning(),
    `inserted ${username}`,
  );
  return user;
}

function me(token: string): Promise<Res> {
  return testApp.request
    .get('/auth/me')
    .set('Authorization', `Bearer ${token}`);
}

function refresh(rawToken: string): Promise<Res> {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

function accessTokenOf(res: Res): string {
  const token = (res.body as { access_token?: unknown }).access_token;
  if (typeof token !== 'string')
    throw new Error(`response (status ${res.status}) carried no access_token`);
  return token;
}

function claimsOf(token: string): Record<string, unknown> {
  const part = defined(token.split('.')[1], 'jwt payload segment');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** The rl_rt a response sets, or undefined when it sets none. */
function rlRtOf(res: Res): string | undefined {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  for (const line of lines) {
    const m = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (m?.[1]) return m[1];
  }
  return undefined;
}

async function issueFamily(userId: number) {
  return testApp.app
    .get(RefreshTokenService)
    .issue(userId, { authMethod: 'local' });
}

/** The real password-change revoke + re-issue; returns the new rl_rt. */
async function changePassword(user: {
  id: number;
  username: string;
  role: Role;
}): Promise<string> {
  const pw = testApp.app.get(PasswordChangeSessionService);
  const version = await pw.revokeAllSessions(user.id);
  const session = await pw.issueSession(user, null, version);
  return session.refresh.rawToken;
}

// ── I6 — refresh vs password change ─────────────────────────────────────────

describe('ROK-1823 I6 — a refresh in flight across a password change', () => {
  it('a token minted from a snapshot taken BEFORE the bump commits is dead after it', async () => {
    const admin = testApp.seed.adminUser;
    const before = await tv(admin.id);
    const issued = await issueFamily(admin.id);
    let reissued: string | undefined;
    const original = mint.mintRefreshAccessToken;
    jest
      .spyOn(mint, 'mintRefreshAccessToken')
      .mockImplementationOnce(async (deps, rotated) => {
        const token = await original(deps, rotated);
        reissued = await changePassword(admin);
        return token;
      });

    const late = await refresh(issued.rawToken);

    expect(late.status).toBe(200);
    const lateToken = accessTokenOf(late);
    expect(claimsOf(lateToken).tv).toBe(before);
    expect(await tv(admin.id)).toBe(before + 1);
    expect({
      lateAccess: (await me(lateToken)).status,
      lateChildRefresh: (await refresh(defined(rlRtOf(late), 'child'))).status,
    }).toEqual({ lateAccess: 401, lateChildRefresh: 401 });

    const fresh = await refresh(defined(reissued, 're-issued rl_rt'));
    expect(fresh.status).toBe(200);
    expect(claimsOf(accessTokenOf(fresh)).tv).toBe(before + 1);
    expect((await me(accessTokenOf(fresh))).status).toBe(200);
  });

  it('concurrent refresh + password change never leaves a usable old-version session', async () => {
    const admin = testApp.seed.adminUser;
    for (let round = 0; round < 3; round++) {
      const before = await tv(admin.id);
      const issued = await issueFamily(admin.id);

      const [res] = await Promise.all([
        refresh(issued.rawToken),
        changePassword(admin),
      ]);

      expect(await tv(admin.id)).toBe(before + 1);
      if (res.status !== 200) {
        expect({ status: res.status, cookie: rlRtOf(res) }).toEqual({
          status: 401,
          cookie: undefined,
        });
        continue;
      }
      const token = accessTokenOf(res);
      expect({
        round,
        mintedVersion: claimsOf(token).tv,
        access: (await me(token)).status,
        child: (await refresh(defined(rlRtOf(res), 'child'))).status,
      }).toEqual({ round, mintedVersion: before, access: 401, child: 401 });
    }
  });
});

// ── I7 — impersonation ───────────────────────────────────────────────────────

/** An operator with a refresh family + a live marker on that family. */
async function impersonating() {
  const admin = await createUser('tv-imp-admin', 'operator');
  const target = await createUser('tv-imp-target', 'member');
  const issued = await issueFamily(admin.id);
  await testApp.app
    .get(ImpersonationSessionService)
    .start(issued.familyId, admin.id, target.id);
  const res = await refresh(issued.rawToken);
  expect(res.status).toBe(200);
  const token = accessTokenOf(res);
  expect(claimsOf(token)).toMatchObject({
    sub: target.id,
    impersonatedBy: admin.id,
    tv: await tv(target.id),
    itv: await tv(admin.id),
  });
  expect((await me(token)).status).toBe(200);
  return { admin, target, token, rt: defined(rlRtOf(res), 'child rl_rt') };
}

async function bump(userId: number): Promise<void> {
  await bumpTokenVersion(testApp.db, userId);
  invalidateAuthUser(userId);
}

describe('ROK-1823 I7 — impersonation tokens carry tv + itv', () => {
  it('the impersonator’s version moving (itv) kills the token; a fresh one works', async () => {
    const { admin, target, token } = await impersonating();

    await bump(admin.id);

    expect({ itvStale: (await me(token)).status }).toEqual({ itvStale: 401 });
    const fresh = await signTestAccessToken(testApp, {
      sub: target.id,
      username: target.username,
      impersonatedBy: admin.id,
    });
    expect((await me(fresh)).status).toBe(200);
  });

  it('impersonator password change → bearer 401 and the next refresh mints no target token', async () => {
    const { admin, token, rt } = await impersonating();

    await changePassword(admin);

    expect({ bearer: (await me(token)).status }).toEqual({ bearer: 401 });
    const next = await refresh(rt);
    expect({
      status: next.status,
      body: (next.body as { access_token?: unknown }).access_token,
    }).toEqual({ status: 401, body: undefined });
  });

  it('the target’s version moving (tv) kills the token; refresh keeps impersonating', async () => {
    const { admin, target, token, rt } = await impersonating();

    await bump(target.id);

    expect({ tvStale: (await me(token)).status }).toEqual({ tvStale: 401 });
    const next = await refresh(rt);
    expect(next.status).toBe(200);
    const renewed = accessTokenOf(next);
    expect(claimsOf(renewed)).toMatchObject({
      sub: target.id,
      impersonatedBy: admin.id,
      tv: await tv(target.id),
      itv: await tv(admin.id),
    });
    expect((await me(renewed)).status).toBe(200);
  });
});

describe('ROK-1823 I7 — impersonation expiry still works', () => {
  it('marker past expires_at → the holder’s own token at its current version', async () => {
    const { admin, rt } = await impersonating();
    await testApp.db
      .update(schema.refreshFamilyImpersonations)
      .set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await refresh(rt);

    expect(res.status).toBe(200);
    const own = accessTokenOf(res);
    const claims = claimsOf(own);
    expect({
      sub: claims.sub,
      by: claims.impersonatedBy,
      tv: claims.tv,
    }).toEqual({ sub: admin.id, by: undefined, tv: await tv(admin.id) });
    expect((await me(own)).status).toBe(200);
  });

  it('marker expiring inside the current second → own token, never born-expired', async () => {
    const { admin, rt } = await impersonating();
    const nowSec = Math.floor(Date.now() / 1000);
    await testApp.db
      .update(schema.refreshFamilyImpersonations)
      .set({ expiresAt: new Date(nowSec * 1000 + 999) })
      .where(
        eq(schema.refreshFamilyImpersonations.impersonatorUserId, admin.id),
      );

    const res = await refresh(rt);

    expect(res.status).toBe(200);
    const claims = claimsOf(accessTokenOf(res));
    expect({ sub: claims.sub, by: claims.impersonatedBy }).toEqual({
      sub: admin.id,
      by: undefined,
    });
    expect(Number(claims.exp)).toBeGreaterThan(Number(claims.iat));
    expect((await me(accessTokenOf(res))).status).toBe(200);
  });
});
