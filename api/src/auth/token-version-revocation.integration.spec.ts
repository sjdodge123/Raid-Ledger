/**
 * ROK-1823 I1–I5, I8 — every revoke path bumps `users.token_version`, and an
 * access JWT whose `tv` no longer matches is a 401 while a token minted at the
 * new version works. Deactivation/ban/kick do NOT bump (operator ruling): the
 * deactivation lockout refuses that user instead. Real DB, real HTTP.
 */
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { defined, nonEmpty } from '../common/testing/narrow';
import {
  currentTokenVersion,
  signTestAccessToken,
} from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import { UsersModerationService } from '../users/users-moderation.service';
import { REFRESH_COOKIE_NAME } from './refresh/refresh-cookie.helpers';
import { RefreshTokenService } from './refresh/refresh-token.service';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

type Res = { status: number; body: unknown; headers: Record<string, unknown> };

async function createMember(username: string) {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `discord-${username}`, username, role: 'member' })
      .returning(),
    `inserted ${username}`,
  );
  return user;
}

const tokenFor = (user: { id: number; username: string }) =>
  signTestAccessToken(testApp, { sub: user.id, username: user.username });

const tv = (userId: number) => currentTokenVersion(testApp.db, userId);

function me(token: string): Promise<Res> {
  return testApp.request
    .get('/users/me')
    .set('Authorization', `Bearer ${token}`);
}

function refresh(rawToken: string): Promise<Res> {
  return testApp.request
    .post('/auth/refresh')
    .set('Cookie', `${REFRESH_COOKIE_NAME}=${rawToken}`);
}

async function issueFamily(userId: number): Promise<string> {
  const issued = await testApp.app
    .get(RefreshTokenService)
    .issue(userId, { authMethod: 'local' });
  return issued.rawToken;
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

function rlRtFrom(res: Res): string {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [String(raw)];
  for (const line of lines) {
    const m = line.match(new RegExp(`${REFRESH_COOKIE_NAME}=([^;]*)`));
    if (m?.[1]) return m[1];
  }
  throw new Error(`response (status ${res.status}) set no rl_rt cookie`);
}

async function backdateRotations(userId: number): Promise<void> {
  await testApp.db
    .update(schema.refreshTokens)
    .set({ rotatedAt: new Date(Date.now() - 2 * 60 * 1000) })
    .where(eq(schema.refreshTokens.userId, userId));
}

async function loginLocal(): Promise<Res> {
  const res: Res = await testApp.request.post('/auth/local').send({
    email: testApp.seed.adminEmail,
    password: testApp.seed.adminPassword,
  });
  expect(res.status).toBe(200);
  return res;
}

describe('ROK-1823 I1 — password change bumps the version once', () => {
  it('old access tokens and rl_rt die; the re-issued session and a fresh token work', async () => {
    const admin = testApp.seed.adminUser;
    const before = await tv(admin.id);
    const other = await loginLocal();
    const caller = await loginLocal();
    const signed = await tokenFor(admin);

    const res: Res = await testApp.request
      .post('/admin/onboarding/change-password')
      .set('Authorization', `Bearer ${accessTokenOf(caller)}`)
      .send({
        currentPassword: testApp.seed.adminPassword,
        newPassword: 'BrandNewPassword123!',
      });
    expect(res.status).toBe(200);

    expect(await tv(admin.id)).toBe(before + 1);
    expect({
      other: (await me(accessTokenOf(other))).status,
      caller: (await me(accessTokenOf(caller))).status,
      signedBefore: (await me(signed)).status,
      otherRefresh: (await refresh(rlRtFrom(other))).status,
    }).toEqual({
      other: 401,
      caller: 401,
      signedBefore: 401,
      otherRefresh: 401,
    });

    const reissued = accessTokenOf(res);
    expect(claimsOf(reissued).tv).toBe(before + 1);
    expect((await me(reissued)).status).toBe(200);
    expect((await me(await tokenFor(admin))).status).toBe(200);
    const rotated = await refresh(rlRtFrom(res));
    expect(rotated.status).toBe(200);
    expect((await me(accessTokenOf(rotated))).status).toBe(200);
  });
});

describe('ROK-1823 I2 — setRole bumps the version', () => {
  it('the member token 401s; refresh mints the new role at the new version', async () => {
    const member = await createMember('tv-promoted');
    const before = await tv(member.id);
    const old = await tokenFor(member);
    const rt = await issueFamily(member.id);
    expect((await me(old)).status).toBe(200); // warm the auth-user cache

    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .patch(`/users/${member.id}/role`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'operator' });
    expect(res.status).toBe(200);

    expect(await tv(member.id)).toBe(before + 1);
    expect({ old: (await me(old)).status }).toEqual({ old: 401 });
    const renewed = await refresh(rt);
    expect(renewed.status).toBe(200);
    const token = accessTokenOf(renewed);
    expect(claimsOf(token)).toMatchObject({ role: 'operator', tv: before + 1 });
    expect((await me(token)).status).toBe(200);
  });
});

describe('ROK-1823 I3 — refresh reuse bumps the version user-wide', () => {
  it('a second, untouched family loses its access token but its refresh still rotates', async () => {
    const member = await createMember('tv-reuse');
    const rtA = await issueFamily(member.id);
    const rtB = await issueFamily(member.id);
    const firstA = await refresh(rtA);
    expect(firstA.status).toBe(200);
    const firstB = await refresh(rtB);
    expect(firstB.status).toBe(200);
    const tokenB = accessTokenOf(firstB);
    expect((await me(tokenB)).status).toBe(200);
    const before = await tv(member.id);

    await backdateRotations(member.id);
    expect((await refresh(rtA)).status).toBe(401); // theft detected

    expect(await tv(member.id)).toBe(before + 1);
    expect({ untouchedFamilyToken: (await me(tokenB)).status }).toEqual({
      untouchedFamilyToken: 401,
    });
    expect((await refresh(rlRtFrom(firstA))).status).toBe(401);
    const renewedB = await refresh(rlRtFrom(firstB));
    expect(renewedB.status).toBe(200);
    expect(claimsOf(accessTokenOf(renewedB)).tv).toBe(before + 1);
    expect((await me(accessTokenOf(renewedB))).status).toBe(200);
  });
});

describe('ROK-1823 I4 — delete', () => {
  it('a deleted user’s token 401s even with a warm auth-user cache', async () => {
    const member = await createMember('tv-deleted');
    const token = await tokenFor(member);
    expect((await me(token)).status).toBe(200); // warm the auth-user cache

    const admin = await loginAsAdmin(testApp.request, testApp.seed);
    const res = await testApp.request
      .delete(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(204);

    expect({ afterDelete: (await me(token)).status }).toEqual({
      afterDelete: 401,
    });
  });
});

describe('ROK-1823 I5 — deactivation / ban / kick do NOT bump', () => {
  it('deactivation leaves the version unchanged and the lockout still refuses the user', async () => {
    const member = await createMember('tv-leaver');
    const token = await tokenFor(member);
    const before = await tv(member.id);
    expect((await me(token)).status).toBe(200);

    await testApp.app.get(DiscordNotificationService).deactivateUser(member.id);

    expect({ tokenVersion: await tv(member.id) }).toEqual({
      tokenVersion: before,
    });
    const res = await me(token);
    expect({
      status: res.status,
      code: (res.body as { code?: unknown }).code,
    }).toEqual({ status: 401, code: 'USER_DEACTIVATED' });
  });

  it('ban and kick leave the version unchanged and still refuse the token', async () => {
    const banned = await createMember('tv-banned');
    const kicked = await createMember('tv-kicked');
    const bannedToken = await tokenFor(banned);
    const kickedToken = await tokenFor(kicked);
    const versions = {
      banned: await tv(banned.id),
      kicked: await tv(kicked.id),
    };
    const moderation = testApp.app.get(UsersModerationService);
    const actorId = testApp.seed.adminUser.id;

    await moderation.banUser(actorId, banned.id, {
      wipeData: false,
      kickFromDiscord: false,
    });
    await moderation.kickUser(actorId, kicked.id, { kickFromDiscord: false });

    expect({
      banned: await tv(banned.id),
      kicked: await tv(kicked.id),
    }).toEqual(versions);
    expect({
      banned: (await me(bannedToken)).status,
      kicked: (await me(kickedToken)).status,
    }).toEqual({ banned: 401, kicked: 401 });
  });
});

describe('ROK-1823 I8 — transition: a session token without `tv`', () => {
  it('is a 401, and the same user’s live rl_rt recovers into a working `tv` token', async () => {
    const member = await createMember('tv-legacy');
    const rt = await issueFamily(member.id);
    const legacy = testApp.app
      .get(JwtService)
      .sign({ sub: member.id, username: member.username, role: 'member' });

    expect({ legacy: (await me(legacy)).status }).toEqual({ legacy: 401 });

    const renewed = await refresh(rt);
    expect(renewed.status).toBe(200);
    const token = accessTokenOf(renewed);
    expect(claimsOf(token).tv).toBe(await tv(member.id));
    expect((await me(token)).status).toBe(200);
  });
});
