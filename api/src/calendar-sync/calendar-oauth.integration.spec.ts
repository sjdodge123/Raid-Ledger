/**
 * ROK-1592: Google OAuth start + callback against Postgres (plan §3 2d).
 * Google is a `googleHttp.googleFormPost` spy; everything else is real —
 * the signed state, the browser-binding cookie, the single-use nonce, the
 * encrypted upsert and the 302 landing.
 */
import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import {
  createFutureEvent,
  createMemberAndLogin,
  signupViaDb,
} from '../events/signups.integration.spec-helpers';
import {
  CALENDAR_WRITE_QUEUE,
  reconcileJobId,
  writeOffJobId,
} from './calendar-sync.constants';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from '../settings/settings-calendar-sync.helpers';
import {
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_EVENTS_SCOPE,
  GOOGLE_READ_SCOPES,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  googleScopesFor,
} from './providers/google/google-oauth.helpers';
import { buildRedirectUris } from './services/calendar-sync-admin.helpers';
import * as connectHelpers from './services/calendar-connect.helpers';
import { TransientError } from './providers/calendar-provider.errors';
import * as intentHelpers from './services/calendar-oauth-intent.helpers';
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
    // ROK-1595 Q-A: the read scopes are asked for at first connect.
    expect(s.url.searchParams.get('scope')).toBe(
      [GOOGLE_CONNECT_SCOPES, ...GOOGLE_READ_SCOPES].join(' '),
    );
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

describe('OAuth with intent=primary (ROK-1596 D8)', () => {
  const okJson = fixture('token-ok');
  const WITH_EVENTS: GoogleStub = {
    token: {
      status: 200,
      json: {
        ...okJson,
        scope: `${String(okJson.scope)} ${GOOGLE_EVENTS_SCOPE}`,
      },
    },
  };

  function writeQueue(): Queue {
    return testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE));
  }

  async function startPrimary() {
    const res = await testApp.request
      .get(`${START}?intent=primary`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const url = new URL((res.body as { url: string }).url);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const set = raw.find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? '';
    return {
      url,
      state: url.searchParams.get('state') ?? '',
      cookie: set.split(';')[0] ?? '',
    };
  }

  /** A first (connect-intent) grant, then write turned on. */
  async function connectedWithWrite() {
    await connectWith(OK);
    jest.restoreAllMocks();
    const [row] = nonEmpty(await rowsOf(user.userId), 'connection');
    await testApp.db
      .update(schema.calendarConnections)
      .set({ writeEnabled: true })
      .where(eq(schema.calendarConnections.id, row.id));
    return row.id;
  }

  it('start asks for the connect set + calendar.events; connect never does', async () => {
    const primary = await startPrimary();
    expect(primary.url.searchParams.get('scope')).toBe(
      `${GOOGLE_CONNECT_SCOPES} ${GOOGLE_EVENTS_SCOPE}`,
    );
    const plain = await start();
    expect(plain.url.searchParams.get('scope')).toBe(
      googleScopesFor('connect').join(' '),
    );
    expect(googleScopesFor('connect')).not.toContain(GOOGLE_EVENTS_SCOPE);
  });

  it('400s on an unknown intent', async () => {
    const res = await testApp.request
      .get(`${START}?intent=bogus`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(400);
  });

  it('grant with calendar.events → write_target primary + a reconcile per active sign-up', async () => {
    const connectionId = await connectedWithWrite();
    const adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    const eventId = await createFutureEvent(testApp, adminToken);
    await signupViaDb(testApp, eventId, user.userId);
    const jobId = reconcileJobId(connectionId, eventId, user.userId);
    await writeQueue().remove(jobId); // ids repeat across truncations
    try {
      stubGoogle(WITH_EVENTS);
      const s = await startPrimary();
      expect(
        await land({ code: 'auth-code-2', state: s.state }, s.cookie),
      ).toEqual({ connected: 'google', error: null });
      const [after] = await rowsOf(user.userId);
      expect(after?.writeTarget).toBe('primary');
      const job = await writeQueue().getJob(jobId);
      expect(job?.data).toEqual({
        kind: 'reconcile',
        connectionId,
        eventId,
        userId: user.userId,
      });
    } finally {
      await writeQueue().remove(jobId);
    }
  });

  it('grant without calendar.events → ?error=scopes, row unchanged, no revoke', async () => {
    await connectedWithWrite();
    const [before] = await rowsOf(user.userId);
    const spy = stubGoogle(OK);
    const s = await startPrimary();
    expect(
      await land({ code: 'auth-code-2', state: s.state }, s.cookie),
    ).toEqual({
      connected: null,
      error: 'scopes',
    });
    expect(formsSentTo(spy, GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
    expect(await rowsOf(user.userId)).toEqual([before]);
  });

  it('primary consent on a DIFFERENT account while the original writes → no second primary row (m4)', async () => {
    const original = await connectedWithWrite();
    stubGoogle({
      token: {
        status: 200,
        json: {
          ...okJson,
          scope: `${String(okJson.scope)} ${GOOGLE_EVENTS_SCOPE}`,
          id_token: idToken({ sub: 'other-sub-m4', email: 'm4@example.test' }),
        },
      },
    });
    const s = await startPrimary();
    expect(
      await land({ code: 'auth-code-2', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const rows = await rowsOf(user.userId);
    const primaries = rows.filter((r) => r.writeTarget === 'primary');
    expect(primaries).toEqual([]);
    const kept = rows.find((r) => r.id === original);
    expect([kept?.writeEnabled, kept?.writeTarget]).toEqual([
      true,
      'dedicated',
    ]);
    expect(rows).toHaveLength(2);
  });

  it('applyConsentIntent throwing after the grant is saved → ?error=unavailable, not exchange (m4)', async () => {
    await connectedWithWrite();
    stubGoogle(WITH_EVENTS);
    jest
      .spyOn(intentHelpers, 'applyConsentIntent')
      .mockRejectedValue(new TransientError('consent_apply'));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const s = await startPrimary();
    expect(
      await land({ code: 'auth-code-2', state: s.state }, s.cookie),
    ).toEqual({ connected: null, error: 'unavailable' });
  });

  it('a connect-intent reconnect without calendar.events demotes a primary target to dedicated (m1)', async () => {
    const id = await connectedWithWrite();
    await testApp.db
      .update(schema.calendarConnections)
      .set({ writeTarget: 'primary', status: 'needs_reconnect' })
      .where(eq(schema.calendarConnections.id, id));
    stubGoogle(OK);
    const s = await start();
    expect(
      await land({ code: 'auth-code-3', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const [after] = await rowsOf(user.userId);
    expect([after?.status, after?.writeTarget]).toEqual([
      'active',
      'dedicated',
    ]);
  });

  it('a reconnect resumes a write-off an auth error interrupted (pipe review m3)', async () => {
    const id = await connectedWithWrite();
    const eventId = await createFutureEvent(
      testApp,
      await loginAsAdmin(testApp.request, testApp.seed),
    );
    // What an auth-failed write-off leaves: write off, calendar + a live link.
    await testApp.db
      .update(schema.calendarConnections)
      .set({
        writeEnabled: false,
        dedicatedCalendarId: 'rl-dedicated',
        status: 'needs_reconnect',
      })
      .where(eq(schema.calendarConnections.id, id));
    await testApp.db.insert(schema.calendarEventLinks).values({
      connectionId: id,
      userId: user.userId,
      eventId,
      calendarId: 'rl-dedicated',
      providerEventId: 'copy-1',
    });
    const jobId = writeOffJobId(id);
    await writeQueue().remove(jobId); // ids repeat across truncations
    try {
      stubGoogle(OK);
      const s = await start();
      expect(
        await land({ code: 'auth-code-4', state: s.state }, s.cookie),
      ).toEqual({ connected: 'google', error: null });
      const job = await writeQueue().getJob(jobId);
      expect(job?.data).toEqual({ kind: 'write-off', connectionId: id });
    } finally {
      await writeQueue().remove(jobId);
    }
  });
});

describe('OAuth with intent=read (ROK-1593 D-R3)', () => {
  const okJson = fixture('token-ok');
  const WITH_READ: GoogleStub = {
    token: {
      status: 200,
      json: {
        ...okJson,
        scope: [String(okJson.scope), ...GOOGLE_READ_SCOPES].join(' '),
      },
    },
  };

  async function startRead() {
    const res = await testApp.request
      .get(`${START}?intent=read`)
      .set('Authorization', `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    const url = new URL((res.body as { url: string }).url);
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const set = raw.find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? '';
    return {
      url,
      state: url.searchParams.get('state') ?? '',
      cookie: set.split(';')[0] ?? '',
    };
  }

  /** A connected row that sends to `primary` without calendar.events (§1.1). */
  async function connectedPrimaryWriter() {
    await connectWith(OK);
    jest.restoreAllMocks();
    const [row] = nonEmpty(await rowsOf(user.userId), 'connection');
    await testApp.db
      .update(schema.calendarConnections)
      .set({
        writeEnabled: true,
        writeTarget: 'primary',
        dedicatedCalendarId: 'rl-dedicated',
      })
      .where(eq(schema.calendarConnections.id, row.id));
    return row.id;
  }

  function readAndWriteFields(
    r: typeof schema.calendarConnections.$inferSelect | undefined,
  ) {
    return {
      readAccessGranted: r?.readAccessGranted,
      readEnabled: r?.readEnabled,
      writeEnabled: r?.writeEnabled,
      writeTarget: r?.writeTarget,
      dedicatedCalendarId: r?.dedicatedCalendarId,
    };
  }

  it('start asks exactly openid + email + the two read scopes', async () => {
    const s = await startRead();
    expect(s.url.searchParams.get('scope')).toBe(
      googleScopesFor('read').join(' '),
    );
    expect(s.url.searchParams.get('scope')).toBe(
      ['openid', 'email', ...GOOGLE_READ_SCOPES].join(' '),
    );
  });

  it('grant with the read scopes → read flags on, write fields untouched even without calendar.events (§1.1)', async () => {
    const id = await connectedPrimaryWriter();
    const spy = stubGoogle(WITH_READ);
    const s = await startRead();
    expect(
      await land({ code: 'auth-code-r1', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const rows = await rowsOf(user.userId);
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(readAndWriteFields(rows[0])).toEqual({
      readAccessGranted: true,
      readEnabled: true,
      writeEnabled: true,
      writeTarget: 'primary',
      dedicatedCalendarId: 'rl-dedicated',
    });
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
  });

  it('grant without the read scopes → ?error=read_scopes, row unchanged, no revoke', async () => {
    await connectedPrimaryWriter();
    const [before] = await rowsOf(user.userId);
    const spy = stubGoogle(OK);
    const s = await startRead();
    expect(
      await land({ code: 'auth-code-r2', state: s.state }, s.cookie),
    ).toEqual({ connected: null, error: 'read_scopes' });
    expect(formsSentTo(spy, GOOGLE_TOKEN_URL)).toHaveLength(1);
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
    expect(await rowsOf(user.userId)).toEqual([before]);
  });

  it('ROK-1595 Q-A: a first connect whose grant carries the read scopes turns read on, write fields untouched', async () => {
    const spy = stubGoogle(WITH_READ);
    const s = await start();
    expect(
      await land({ code: 'auth-code-r3', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const [row] = nonEmpty(await rowsOf(user.userId), 'connection');
    expect(readAndWriteFields(row)).toEqual({
      readAccessGranted: true,
      readEnabled: true,
      writeEnabled: false,
      writeTarget: 'dedicated',
      dedicatedCalendarId: null,
    });
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
  });

  it('ROK-1595 Q-A: a first connect with the read boxes unticked still connects, write-only', async () => {
    const spy = stubGoogle(OK);
    const s = await start();
    expect(
      await land({ code: 'auth-code-r4', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const [row] = nonEmpty(await rowsOf(user.userId), 'connection');
    expect(readAndWriteFields(row)).toEqual({
      readAccessGranted: false,
      readEnabled: false,
      writeEnabled: false,
      writeTarget: 'dedicated',
      dedicatedCalendarId: null,
    });
    expect(formsSentTo(spy, GOOGLE_REVOKE_URL)).toEqual([]);
  });

  it('ROK-1595 Q-A: a reconnect keeps read off when the user turned it off', async () => {
    await connectWith(OK);
    jest.restoreAllMocks();
    const [first] = nonEmpty(await rowsOf(user.userId), 'connection');
    const id = first.id;
    await testApp.db
      .update(schema.calendarConnections)
      .set({ readAccessGranted: true, readEnabled: false })
      .where(eq(schema.calendarConnections.id, id));
    stubGoogle(WITH_READ);
    const s = await start();
    expect(
      await land({ code: 'auth-code-r5', state: s.state }, s.cookie),
    ).toEqual({ connected: 'google', error: null });
    const rows = await rowsOf(user.userId);
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(readAndWriteFields(rows[0])).toEqual({
      readAccessGranted: true,
      readEnabled: false,
      writeEnabled: false,
      writeTarget: 'dedicated',
      dedicatedCalendarId: null,
    });
  });
});
