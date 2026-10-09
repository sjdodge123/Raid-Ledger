/**
 * ROK-1592: Google OAuth start + callback against Postgres (plan §3 2d).
 * Google is a `googleHttp.googleFormPost` spy; everything else is real —
 * the signed state, the browser-binding cookie, the single-use nonce, the
 * encrypted upsert and the 302 landing.
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from '../settings/settings-calendar-sync.helpers';
import {
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
} from './providers/google/google-oauth.helpers';
import { buildRedirectUris } from './services/calendar-sync-admin.helpers';
import * as connectHelpers from './services/calendar-connect.helpers';
import { mintCalendarOAuthState } from './services/calendar-oauth-state.helpers';
import {
  decryptCalendarCredentials,
  isEncryptedCredentials,
} from './services/calendar-credentials.helpers';
import {
  CALLBACK,
  enableGoogle,
  FIXTURE_ACCESS,
  FIXTURE_EMAIL,
  FIXTURE_REFRESH,
  FIXTURE_SUB,
  fixture,
  formsSentTo,
  idToken,
  START,
  STATE_COOKIE,
  stateCookieFor,
  stubGoogle,
  type GoogleStub,
} from './calendar-oauth.integration.spec-helpers';

const sentryActual =
  jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs');

let testApp: TestApp;
let user: { userId: number; token: string };
let userSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await enableGoogle(testApp);
  userSeq += 1;
  user = await createMemberAndLogin(
    testApp,
    `cal-oauth-${userSeq}`,
    `cal-oauth-${userSeq}@example.test`,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

const OK: GoogleStub = { token: { status: 200, json: fixture('token-ok') } };

function settings(): SettingsService {
  return testApp.app.get(SettingsService);
}

function rowsOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.userId, userId));
}

async function start(token = user.token) {
  const res = await testApp.request
    .get(START)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const url = new URL((res.body as { url: string }).url);
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const setCookie = raw.find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? '';
  return {
    url,
    state: url.searchParams.get('state') ?? '',
    setCookie,
    cookie: setCookie.split(';')[0] ?? '',
  };
}

/** Hit the callback; answers the landing URL's `connected` / `error` param. */
async function land(query: Record<string, string>, cookie?: string) {
  const req = testApp.request.get(CALLBACK).query(query);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  expect(res.status).toBe(302);
  const loc = new URL(String(res.headers.location));
  expect(loc.pathname).toBe('/profile/gaming/calendars');
  return {
    connected: loc.searchParams.get('connected'),
    error: loc.searchParams.get('error'),
  };
}

async function connectWith(stub: GoogleStub) {
  const spy = stubGoogle(stub);
  const s = await start();
  const landed = await land({ code: 'auth-code-1', state: s.state }, s.cookie);
  return { spy, landed };
}

describe('GET /users/me/calendars/oauth/:provider/start', () => {
  it('404s while the kill switch is off', async () => {
    await setCalendarSyncEnabled(settings(), false);
    const res = await testApp.request
      .get(START)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(404);
  });

  it('404s when Google has no client configured', async () => {
    await setCalendarProviderConfig(settings(), 'google', {
      clientId: '',
      clientSecret: '',
    });
    const res = await testApp.request
      .get(START)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(404);
  });

  it.each(['microsoft', 'apple', 'nope'])(
    '404s for the unshipped provider %s',
    async (provider) => {
      const res = await testApp.request
        .get(`/users/me/calendars/oauth/${provider}/start`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(404);
    },
  );

  it('401s without a JWT', async () => {
    expect((await testApp.request.get(START)).status).toBe(401);
  });

  it('answers the consent URL and sets the httpOnly binding cookie', async () => {
    const s = await start();
    expect(s.url.host).toBe('accounts.google.com');
    expect(s.url.searchParams.get('scope')).toBe(GOOGLE_CONNECT_SCOPES);
    expect(s.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(s.url.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(s.url.searchParams.get('redirect_uri')).toBe(
      (await buildRedirectUris(settings())).google,
    );
    expect(s.state.length).toBeGreaterThan(20);
    expect(s.setCookie.startsWith(`${STATE_COOKIE}=`)).toBe(true);
    expect(s.setCookie).toMatch(/HttpOnly/i);
  });
});

describe('GET /calendar-sync/oauth/:provider/callback — errors', () => {
  it('bad signature → ?error=state', async () => {
    const s = await start();
    const flipped = s.state.slice(0, -1) + (s.state.endsWith('A') ? 'B' : 'A');
    expect(await land({ code: 'c', state: flipped }, s.cookie)).toEqual({
      connected: null,
      error: 'state',
    });
  });

  it('expired state → ?error=state', async () => {
    const r = 'expired-binding';
    const { state } = mintCalendarOAuthState({
      uid: user.userId,
      provider: 'google',
      bindToBrowser: () => r,
      nowMs: Date.now() - 11 * 60 * 1000,
    });
    expect((await land({ code: 'c', state }, stateCookieFor(r))).error).toBe(
      'state',
    );
  });

  it('missing binding cookie → ?error=state', async () => {
    const s = await start();
    expect((await land({ code: 'c', state: s.state })).error).toBe('state');
  });

  it('replayed state → ?error=state on the second use', async () => {
    const s = await start();
    expect(
      (await land({ error: 'access_denied', state: s.state }, s.cookie)).error,
    ).toBe('denied');
    expect(
      (await land({ error: 'access_denied', state: s.state }, s.cookie)).error,
    ).toBe('state');
  });

  it('error=access_denied → ?error=denied, Google never called', async () => {
    const spy = stubGoogle(OK);
    const s = await start();
    expect(
      (await land({ error: 'access_denied', state: s.state }, s.cookie)).error,
    ).toBe('denied');
    expect(spy).not.toHaveBeenCalled();
  });

  it('token endpoint 400 invalid_grant → ?error=exchange, no row', async () => {
    const { landed } = await connectWith({
      token: { status: 400, json: fixture('token-400') },
    });
    expect(landed.error).toBe('exchange');
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });

  it('calendar scope unticked → ?error=scopes, the grant is revoked, no row (Q-F)', async () => {
    const { spy, landed } = await connectWith({
      token: { status: 200, json: fixture('token-missing-scope') },
    });
    expect(landed.error).toBe('scopes');
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: FIXTURE_REFRESH },
    ]);
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });

  it('a first grant without a refresh token → ?error=exchange, its access token is revoked, no row', async () => {
    const { spy, landed } = await connectWith({
      token: { status: 200, json: fixture('token-no-refresh') },
    });
    expect(landed.error).toBe('exchange');
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: FIXTURE_ACCESS },
    ]);
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });

  it('the upsert throws a non-provider error → 302 ?error=unavailable, the fresh grant is revoked, captured in Sentry, logged by class only', async () => {
    const thrown = new TypeError('db down SECRET-DETAIL');
    jest
      .spyOn(connectHelpers, 'upsertCalendarConnection')
      .mockRejectedValue(thrown);
    // The real module object: the controller's namespace import reads through it.
    const captured = jest
      .spyOn(sentryActual, 'captureException')
      .mockImplementation(() => 'event-id');
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { spy, landed } = await connectWith(OK);
    expect(landed.error).toBe('unavailable');
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([
      { token: FIXTURE_REFRESH },
    ]);
    const lines = JSON.stringify(logged.mock.calls);
    expect(lines).toContain('TypeError');
    expect(lines).not.toContain('SECRET-DETAIL');
    expect(captured).toHaveBeenCalledWith(thrown);
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });

  it('kill switch off at the callback → ?error=disabled, Google never called', async () => {
    const spy = stubGoogle(OK);
    const s = await start();
    await setCalendarSyncEnabled(settings(), false);
    expect((await land({ code: 'c', state: s.state }, s.cookie)).error).toBe(
      'disabled',
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('GET /calendar-sync/oauth/:provider/callback — connect', () => {
  it('stores one encrypted active row and lands on ?connected=google', async () => {
    const { spy, landed } = await connectWith(OK);
    expect(landed).toEqual({ connected: 'google', error: null });
    const [token] = formsSentTo(spy, GOOGLE_TOKEN_URL);
    expect(token?.redirect_uri).toBe(
      (await buildRedirectUris(settings())).google,
    );
    expect(token?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await rowsOf(user.userId);
    expect(rows).toHaveLength(1);
    const [row] = nonEmpty(rows, 'connection');
    expect(row).toMatchObject({
      provider: 'google',
      accountSubject: FIXTURE_SUB,
      accountLabel: FIXTURE_EMAIL,
      status: 'active',
      writeEnabled: false,
      readEnabled: false,
    });
    expect(row.credentialsEncrypted).not.toContain(FIXTURE_REFRESH);
    expect(isEncryptedCredentials(row.credentialsEncrypted)).toBe(true);
    expect(decryptCalendarCredentials(row.credentialsEncrypted)).toMatchObject({
      kind: 'oauth',
      accessToken: FIXTURE_ACCESS,
      refreshToken: FIXTURE_REFRESH,
    });
  });

  it('the overview never carries a token string', async () => {
    await connectWith(OK);
    const res = await testApp.request
      .get('/users/me/calendars')
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(FIXTURE_EMAIL);
    expect(body).not.toContain(FIXTURE_ACCESS);
    expect(body).not.toContain(FIXTURE_REFRESH);
  });

  it('a second connect of the same sub updates the row and keeps the stored refresh token', async () => {
    await connectWith(OK);
    const [first] = await rowsOf(user.userId);
    jest.restoreAllMocks();
    const renamed = {
      ...fixture('token-no-refresh'),
      id_token: idToken({ email: 'renamed@example.test' }),
    };
    const { landed } = await connectWith({
      token: { status: 200, json: renamed },
    });
    expect(landed.connected).toBe('google');
    const rows = await rowsOf(user.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(first?.id);
    expect(rows[0]?.accountLabel).toBe('renamed@example.test');
    expect(
      decryptCalendarCredentials(rows[0]?.credentialsEncrypted ?? ''),
    ).toMatchObject({
      refreshToken: FIXTURE_REFRESH,
    });
  });
});
