/**
 * ROK-1592: GoogleCalendarAdapter over the spied HTTP seam — connect, the
 * Q-F scopes path (revoke attempted, nothing returned), refresh, disconnect.
 * ROK-1596 G2: the write capability passes the write conformance suite
 * against an in-memory Google behind `googleJsonRequest`, and the registry
 * routes a real Google row's writes to this adapter.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import * as googleHttp from './google-http';
import { GoogleCalendarAdapter } from './google.adapter';
import { GOOGLE_REVOKE_URL, MissingScopesError } from './google-oauth.helpers';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderNotConfiguredError,
  ProviderRequestError,
  TransientError,
} from '../calendar-provider.errors';
import type { OAuthCredentials } from '../calendar-provider.interface';
import {
  CalendarProviderRegistry,
  DEMO_FAKE_SUBJECT_PREFIX,
  type DemoModeSource,
} from '../calendar-provider.registry';
import { describeCalendarWriteConformance } from '../testing/calendar-provider.conformance.spec-helpers';
import { FakeGoogleCalendarApi } from './google-calendar-api.spec-helpers';
import { GOOGLE_CALENDAR_API } from './google-write.helpers';

type Json = Record<string, unknown>;
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as Json;

const CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
const OK = fixture('token-ok');
const CODE_INPUT = {
  code: 'c',
  codeVerifier: 'v',
  redirectUri: 'https://x/cb',
};

function adapter(values: Record<string, string>): GoogleCalendarAdapter {
  const settings = {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
  } as unknown as SettingsCore;
  return new GoogleCalendarAdapter(settings);
}
const configured = (clientId = CLIENT_ID) =>
  adapter({
    [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID]: clientId,
    [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET]: 'secret',
  });

let post: jest.SpyInstance;
beforeEach(() => {
  post = jest.spyOn(googleHttp, 'googleFormPost');
});
afterEach(() => jest.restoreAllMocks());
const reply = (status: number, json: unknown) =>
  post.mockResolvedValueOnce({ status, json, retryAfter: null });

describe('GoogleCalendarAdapter', () => {
  it('is configured only with both client id and secret', async () => {
    await expect(configured().isConfigured()).resolves.toBe(true);
    const noSecret = adapter({
      [SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_ID]: CLIENT_ID,
    });
    await expect(noSecret.isConfigured()).resolves.toBe(false);
    await expect(
      noSecret.buildAuthUrl({
        state: 's',
        codeChallenge: 'c',
        redirectUri: 'r',
      }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('connect returns sub, email label and the token grant', async () => {
    reply(200, OK);
    const result = await configured().connect(CODE_INPUT);
    expect(result.accountSubject).toBe('109876543210987654321');
    expect(result.accountLabel).toBe('raider@example.test');
    expect(result.credentials).toMatchObject({
      kind: 'oauth',
      accessToken: OK.access_token,
      refreshToken: OK.refresh_token,
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('connect without calendar.app.created revokes and throws MissingScopesError', async () => {
    reply(200, fixture('token-missing-scope'));
    reply(200, null);
    await expect(configured().connect(CODE_INPUT)).rejects.toBeInstanceOf(
      MissingScopesError,
    );
    expect(post).toHaveBeenLastCalledWith(
      GOOGLE_REVOKE_URL,
      { token: OK.refresh_token },
      { timeoutMs: 5_000 },
    );
  });

  it('connect with a foreign aud revokes and throws ProviderAuthError', async () => {
    reply(200, OK);
    reply(500, null);
    const err = await configured('other-client')
      .connect(CODE_INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect((err as ProviderAuthError).reason).toBe('id_token_aud');
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('GoogleCalendarAdapter refresh + disconnect', () => {
  it('refresh keeps the stored refresh token when Google omits it', async () => {
    reply(200, fixture('token-no-refresh'));
    const next = await configured().refresh({
      kind: 'oauth',
      accessToken: 'old',
      refreshToken: 'stored-rt',
      expiresAt: '2026-10-08T00:00:00.000Z',
      scopes: ['openid'],
    });
    expect(next.refreshToken).toBe('stored-rt');
    expect(next.accessToken).toBe(OK.access_token);
  });

  it('disconnect revokes the refresh token; caldav is a no-op', async () => {
    reply(200, null);
    const a = configured();
    await a.disconnect({
      kind: 'oauth',
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: '2026-10-08T00:00:00.000Z',
      scopes: [],
    });
    expect(post).toHaveBeenCalledWith(
      GOOGLE_REVOKE_URL,
      { token: 'rt' },
      { timeoutMs: 5_000 },
    );
    await a.disconnect({ kind: 'caldav', username: 'u', appPassword: 'p' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

const CREDS: OAuthCredentials = {
  kind: 'oauth',
  accessToken: 'ya29.write-token',
  refreshToken: 'rt',
  expiresAt: '2026-11-01T00:00:00.000Z',
  scopes: [],
};

function fakeGoogle(): {
  api: FakeGoogleCalendarApi;
  a: GoogleCalendarAdapter;
} {
  const api = new FakeGoogleCalendarApi();
  jest.spyOn(googleHttp, 'googleJsonRequest').mockImplementation(api.handle);
  return { api, a: configured() };
}

describeCalendarWriteConformance(() => {
  const { api, a } = fakeGoogle();
  return {
    provider: a,
    credentials: CREDS,
    removeCalendarRemotely: (id) => api.removeCalendar(id),
    readCopy: (ref) => {
      const e = api.event(ref.calendarId, ref.providerEventId);
      return Promise.resolve(
        e
          ? { title: String(e.summary), busy: e.transparency !== 'transparent' }
          : null,
      );
    },
  };
}, 'GoogleCalendarAdapter');

const COPY = {
  copyId: 'rl:0123456789ab:42:7',
  title: 'Molten Core',
  description: 'https://raid.example.test/events/42',
  url: 'https://raid.example.test/events/42',
  start: new Date('2026-11-01T19:00:00.000Z'),
  end: new Date('2026-11-01T22:00:00.000Z'),
  tentative: false,
};

describe('GoogleCalendarAdapter write — Google specifics', () => {
  it('sends the stored access token as the bearer on every write', async () => {
    const { api, a } = fakeGoogle();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    await a.upsertEvent(CREDS, cal, COPY, null);
    expect(api.requests.map((r) => r.accessToken)).toEqual([
      'ya29.write-token',
      'ya29.write-token',
      'ya29.write-token',
    ]);
  });

  it('a create with no ref looks the rlCopyId up (events.list) before events.insert (M1)', async () => {
    const { api, a } = fakeGoogle();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    api.requests.length = 0;
    await a.upsertEvent(CREDS, cal, COPY, null);
    const calls = api.requests.map((r) => `${r.method} ${r.url.split('?')[0]}`);
    const events = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(cal)}/events`;
    expect(calls).toEqual([`GET ${events}`, `POST ${events}`]);
  });

  it('a copy the user deleted (cancelled) comes back confirmed on patch (m5)', async () => {
    const { api, a } = fakeGoogle();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    const ref = await a.upsertEvent(CREDS, cal, COPY, null);
    api.cancelEvent(cal, ref.providerEventId);
    await a.upsertEvent(CREDS, cal, COPY, ref);
    expect(api.event(cal, ref.providerEventId)?.status).toBe('confirmed');
  });

  it('a cancelled copy is not adopted by a ref-less create — a new copy is inserted', async () => {
    const { api, a } = fakeGoogle();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    const ref = await a.upsertEvent(CREDS, cal, COPY, null);
    api.cancelEvent(cal, ref.providerEventId);
    const next = await a.upsertEvent(CREDS, cal, COPY, null);
    expect(next.providerEventId).not.toBe(ref.providerEventId);
  });

  it('a known calendar that errors (not 404) is NOT replaced', async () => {
    const { a } = fakeGoogle();
    const req = jest.spyOn(googleHttp, 'googleJsonRequest');
    req.mockResolvedValueOnce({ status: 503, json: null, retryAfter: null });
    const err = await a
      .ensureRaidLedgerCalendar(CREDS, 'known-cal')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientError);
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('a permanent 400 on delete propagates as ProviderRequestError', async () => {
    const { a } = fakeGoogle();
    jest
      .spyOn(googleHttp, 'googleJsonRequest')
      .mockResolvedValueOnce({ status: 400, json: null, retryAfter: null });
    await expect(
      a.deleteEvent(CREDS, { calendarId: 'primary', providerEventId: 'x' }),
    ).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it('patching a copy deleted remotely throws NotFound (caller recreates)', async () => {
    const { a } = fakeGoogle();
    const ref = { calendarId: 'primary', providerEventId: 'gone' };
    const err = await a
      .upsertEvent(CREDS, 'primary', COPY, ref)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('deleting a dedicated calendar that is already gone resolves', async () => {
    const { api, a } = fakeGoogle();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    api.removeCalendar(cal);
    await expect(
      a.deleteRaidLedgerCalendar(CREDS, cal),
    ).resolves.toBeUndefined();
  });

  it('rejects non-OAuth credentials without calling Google', async () => {
    const { api, a } = fakeGoogle();
    const caldav = { kind: 'caldav', username: 'u', appPassword: 'p' } as const;
    const err = await a
      .ensureRaidLedgerCalendar(caldav, null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect((err as ProviderAuthError).reason).toBe('credentials_kind');
    expect(api.requests).toHaveLength(0);
  });
});

describe('CalendarProviderRegistry write routing with the real Google adapter', () => {
  const settings: DemoModeSource = {
    getDemoMode: jest.fn().mockResolvedValue(false),
  };

  it('routes a real (non-demo) Google row to the Google adapter', async () => {
    const google = configured();
    const reg = new CalendarProviderRegistry(settings, google, null);
    await expect(
      reg.getWriteProviderForConnection({
        provider: 'google',
        accountSubject: '109876543210987654321',
      }),
    ).resolves.toBe(google);
  });

  it('never routes a demo-fake row to Google', async () => {
    const reg = new CalendarProviderRegistry(settings, configured(), null);
    await expect(
      reg.getWriteProviderForConnection({
        provider: 'google',
        accountSubject: `${DEMO_FAKE_SUBJECT_PREFIX}user-7`,
      }),
    ).resolves.toBeNull();
  });
});
