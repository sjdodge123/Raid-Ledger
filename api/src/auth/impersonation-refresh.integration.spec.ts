/**
 * ROK-1754 part 2 — server-side impersonation across `/auth/refresh`,
 * logout, family revocation and the JwtStrategy impersonator check (§3.4.4,
 * §3.4.5). Part 1 (start / exit / audit / sweep) is
 * `impersonation.integration.spec.ts`. Sessions are set up through the
 * services (issue a family, start its marker) so any impersonator role works.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { UsersService } from '../users/users.service';
import { invalidateAuthUser } from './auth-user-cache';
import { ImpersonationSessionService } from './impersonation/impersonation-session.service';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { RefreshTokenService } from './refresh/refresh-token.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

const markers = schema.refreshFamilyImpersonations;
type Role = 'member' | 'operator' | 'admin';
type Res = {
  status: number;
  body: Record<string, unknown>;
  headers: Record<string, unknown>;
};

function claimsOf(res: Res): Record<string, unknown> {
  const token = String(res.body.access_token);
  const part = defined(token.split('.')[1], 'jwt payload segment');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function rlRtFrom(res: Res): string {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  for (const line of lines) {
    const m = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (m?.[1]) return m[1];
  }
  throw new Error(`response (status ${res.status}) set no rl_rt cookie`);
}

const cookie = (raw: string) => `${REFRESH_COOKIE_NAME}=${raw}`;

async function refresh(rt: string): Promise<Res> {
  return testApp.request.post('/auth/refresh').set('Cookie', cookie(rt));
}

function me(token: unknown) {
  return testApp.request
    .get('/auth/me')
    .set('Authorization', `Bearer ${String(token)}`);
}

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

async function setUser(
  id: number,
  values: Partial<typeof schema.users.$inferInsert>,
) {
  await testApp.db
    .update(schema.users)
    .set(values)
    .where(eq(schema.users.id, id));
  invalidateAuthUser(id);
}

/** An impersonator with a refresh family + a live marker on that family. */
async function impersonating(impersonatorRole: Role = 'operator') {
  const admin = await createUser('imp-admin', impersonatorRole);
  const target = await createUser('imp-target', 'member');
  const issued = await testApp.app
    .get(RefreshTokenService)
    .issue(admin.id, { authMethod: 'local' });
  await testApp.app
    .get(ImpersonationSessionService)
    .start(issued.familyId, admin.id, target.id);
  return { admin, target, rt: issued.rawToken };
}

async function stopReasons(): Promise<unknown[]> {
  const rows = await testApp.db
    .select()
    .from(schema.adminActions)
    .where(eq(schema.adminActions.action, 'impersonate_stop'));
  return rows.map(
    (r) => (JSON.parse(r.metadata ?? '{}') as { reason?: unknown }).reason,
  );
}

const markerRows = () => testApp.db.select().from(markers);

function expectImpersonating(res: Res, adminId: number, targetId: number) {
  expect(res.status).toBe(200);
  expect(claimsOf(res)).toMatchObject({
    sub: targetId,
    impersonatedBy: adminId,
  });
}

function expectOwnToken(res: Res, adminId: number) {
  expect(res.status).toBe(200);
  const claims = claimsOf(res);
  expect({ sub: claims.sub, impersonatedBy: claims.impersonatedBy }).toEqual({
    sub: adminId,
    impersonatedBy: undefined,
  });
}

// ── refresh while the marker is live ─────────────────────────────────────────

describe('POST /auth/refresh with a live impersonation marker (ROK-1754)', () => {
  it('mints the target token, impersonatedBy = admin, exp capped at the marker', async () => {
    const { admin, target, rt } = await impersonating();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await testApp.db.update(markers).set({ expiresAt });

    const res = await refresh(rt);

    expectImpersonating(res, admin.id, target.id);
    const claims = claimsOf(res);
    expect(claims.username).toBe('imp-target');
    const capSec = Math.floor(expiresAt.getTime() / 1000);
    expect(Math.abs(Number(claims.exp) - capSec)).toBeLessThanOrEqual(1);
  });

  it('two sequential refreshes in the family both impersonate (reload / second tab)', async () => {
    const { admin, target, rt } = await impersonating();
    const first = await refresh(rt);
    expectImpersonating(first, admin.id, target.id);
    const second = await refresh(rlRtFrom(first));
    expectImpersonating(second, admin.id, target.id);
  });

  it('the in-grace sibling (same parent replayed) still impersonates', async () => {
    const { admin, target, rt } = await impersonating();
    expectImpersonating(await refresh(rt), admin.id, target.id);
    expectImpersonating(await refresh(rt), admin.id, target.id);
  });

  it('a target who is deactivated keeps being impersonated', async () => {
    const { admin, target, rt } = await impersonating();
    await setUser(target.id, { deactivatedAt: new Date() });
    expectImpersonating(await refresh(rt), admin.id, target.id);
    expect(await markerRows()).toHaveLength(1);
  });
});

// ── refresh ends the impersonation ──────────────────────────────────────────

describe('POST /auth/refresh ends an invalid impersonation (ROK-1754)', () => {
  it('marker past expires_at → own token, marker gone, `expired` audit', async () => {
    const { admin, rt } = await impersonating();
    await testApp.db
      .update(markers)
      .set({ expiresAt: new Date(Date.now() - 1000) });
    expectOwnToken(await refresh(rt), admin.id);
    expect(await markerRows()).toEqual([]);
    expect(await stopReasons()).toEqual(['expired']);
  });

  it('target banned → own token + `target_suspended` audit', async () => {
    const { admin, target, rt } = await impersonating();
    await setUser(target.id, { bannedAt: new Date(), banReason: 'x' });
    expectOwnToken(await refresh(rt), admin.id);
    expect(await stopReasons()).toEqual(['target_suspended']);
  });

  it('target kicked → own token, marker gone, `target_suspended` audit (review r1)', async () => {
    const { admin, target, rt } = await impersonating();
    await setUser(target.id, { kickedAt: new Date() });
    expectOwnToken(await refresh(rt), admin.id);
    expect(await markerRows()).toEqual([]);
    expect(await stopReasons()).toEqual(['target_suspended']);
  });

  it('target promoted to admin → own token + `target_promoted` audit', async () => {
    const { admin, target, rt } = await impersonating();
    await setUser(target.id, { role: 'admin' });
    expectOwnToken(await refresh(rt), admin.id);
    expect(await stopReasons()).toEqual(['target_promoted']);
  });
});

// ── the impersonator changes ─────────────────────────────────────────────────

describe('impersonator demoted / banned / deactivated (ROK-1754)', () => {
  it('demoted → the impersonation bearer 401s and refresh mints the own token', async () => {
    const { admin, target, rt } = await impersonating('operator');
    const live = await refresh(rt);
    expectImpersonating(live, admin.id, target.id);
    expect((await me(live.body.access_token)).status).toBe(200);

    await testApp.app.get(UsersService).setRole(admin.id, 'member');

    expect((await me(live.body.access_token)).status).toBe(401);
    expectOwnToken(await refresh(rlRtFrom(live)), admin.id);
    expect(await stopReasons()).toEqual(['impersonator_role_lost']);
  });

  it('banned → the impersonation bearer 401s and refresh 401s', async () => {
    const { admin, target, rt } = await impersonating('admin');
    const live = await refresh(rt);
    expectImpersonating(live, admin.id, target.id);

    // Mirror the ban orchestration: both columns, then revokeAllForUser.
    const now = new Date();
    await setUser(admin.id, {
      bannedAt: now,
      banReason: 'abuse',
      deactivatedAt: now,
    });
    await testApp.app.get(RefreshTokenService).revokeAllForUser(admin.id);

    const bearer = await me(live.body.access_token);
    expect({ status: bearer.status, message: bearer.body.message }).toEqual({
      status: 401,
      message: expect.stringContaining('suspended'),
    });
    expect((await refresh(rlRtFrom(live))).status).toBe(401);
    expect(await markerRows()).toEqual([]);
  });

  it('deactivated → refresh 401 USER_DEACTIVATED and the marker is gone', async () => {
    const { admin, target, rt } = await impersonating('admin');
    const live = await refresh(rt);
    expectImpersonating(live, admin.id, target.id);

    // Mirror deactivateUser: stamp deactivated_at, then revokeAllForUser.
    await setUser(admin.id, { deactivatedAt: new Date() });
    await testApp.app.get(RefreshTokenService).revokeAllForUser(admin.id);

    const res = await refresh(rlRtFrom(live));
    expect({ status: res.status, code: res.body.code }).toEqual({
      status: 401,
      code: 'USER_DEACTIVATED',
    });
    expect((await me(live.body.access_token)).status).toBe(401);
    expect(await markerRows()).toEqual([]);
    expect(await stopReasons()).toEqual(['session_revoked']);
  });
});

// ── logout + reuse revocation ────────────────────────────────────────────────

describe('logout and reuse revocation end the marker (ROK-1754)', () => {
  it('logout → marker gone + one `logout` audit', async () => {
    const { rt } = await impersonating();
    const res = await testApp.request
      .post('/auth/logout')
      .set('Cookie', cookie(rt));
    expect(res.status).toBe(200);
    expect(await markerRows()).toEqual([]);
    expect(await stopReasons()).toEqual(['logout']);
  });

  it('reuse of a consumed token past the grace → family revoked, marker gone', async () => {
    const { admin, target, rt } = await impersonating();
    expectImpersonating(await refresh(rt), admin.id, target.id);
    await testApp.db
      .update(schema.refreshTokens)
      .set({ rotatedAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(schema.refreshTokens.userId, admin.id));

    expect((await refresh(rt)).status).toBe(401);
    expect(await markerRows()).toEqual([]);
    expect(await stopReasons()).toEqual(['session_revoked']);
  });
});
