/**
 * ROK-1592: GoogleCalendarAdapter over the spied HTTP seam — connect, the
 * Q-F scopes path (revoke attempted, nothing returned), refresh, disconnect.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import * as googleHttp from './google-http';
import { GoogleCalendarAdapter } from './google.adapter';
import { GOOGLE_REVOKE_URL, MissingScopesError } from './google-oauth.helpers';
import {
  ProviderAuthError,
  ProviderNotConfiguredError,
} from '../calendar-provider.errors';

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
