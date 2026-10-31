/**
 * ROK-1597 T1, T3, T4, T5 + token error mapping: the Microsoft OAuth
 * helpers over the spied `microsoft-http` seam (no live network).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as microsoftHttp from './microsoft-http';
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftIdentity,
  hasMicrosoftCalendarScope,
  missingMicrosoftScopes,
  normalizeMicrosoftScopes,
  refreshMicrosoftToken,
} from './microsoft-oauth.helpers';
import { MS_ME_URL, MS_TOKEN_URL } from './microsoft-graph.constants';
import { codeChallengeFor } from '../../services/calendar-oauth-state.helpers';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as unknown;
const CLIENT = { clientId: 'fake-ms-client-id', clientSecret: 'fake-secret' };
const NOW = Date.parse('2026-11-01T12:00:00Z');
const VERIFIER = 'conformance-verifier-0123456789abcdefghijklmnopq';

let post: jest.SpyInstance;
beforeEach(() => {
  post = jest.spyOn(microsoftHttp, 'microsoftFormPost');
});
afterEach(() => jest.restoreAllMocks());
const reply = (
  status: number,
  json: unknown,
  retryAfter: string | null = null,
) => post.mockResolvedValueOnce({ status, json, retryAfter });
const sentForm = (): Record<string, string> => {
  const call: unknown[] | undefined = post.mock.calls[0];
  expect(call?.[0]).toBe(MS_TOKEN_URL);
  return (call?.[1] ?? {}) as Record<string, string>;
};

describe('buildMicrosoftAuthUrl (T1)', () => {
  it('targets the common v2.0 authorize endpoint with PKCE S256 and the ruled scopes', () => {
    const url = new URL(
      buildMicrosoftAuthUrl({
        clientId: CLIENT.clientId,
        redirectUri:
          'https://slot-1.example/api/calendar-sync/oauth/microsoft/callback',
        state: 'signed-state',
        codeChallenge: codeChallengeFor(VERIFIER),
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'fake-ms-client-id',
      response_type: 'code',
      redirect_uri:
        'https://slot-1.example/api/calendar-sync/oauth/microsoft/callback',
      response_mode: 'query',
      scope: 'offline_access User.Read Calendars.ReadWrite',
      state: 'signed-state',
      code_challenge: codeChallengeFor(VERIFIER),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });
});

describe('exchangeMicrosoftCode', () => {
  it('sends the PKCE verifier, secret and exact redirect_uri, and parses the grant', async () => {
    reply(200, fixture('token-ok'));
    const tokens = await exchangeMicrosoftCode(
      CLIENT,
      {
        code: 'auth-code',
        codeVerifier: VERIFIER,
        redirectUri: 'https://x/cb',
      },
      NOW,
    );
    expect(sentForm()).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: 'https://x/cb',
      client_id: 'fake-ms-client-id',
      client_secret: 'fake-secret',
      code_verifier: VERIFIER,
    });
    expect(tokens).toEqual({
      accessToken: 'EwB-FAKE-MS-ACCESS-TOKEN-fixture',
      refreshToken: 'M.C-FAKE-MS-REFRESH-TOKEN-fixture',
      expiresAt: new Date(NOW + 3599 * 1000).toISOString(),
      scopes: [
        'https://graph.microsoft.com/Calendars.ReadWrite',
        'https://graph.microsoft.com/User.Read',
      ],
    });
  });
});

describe('exchangeMicrosoftCode errors', () => {
  it.each([
    { fx: 'token-invalid-grant', reason: 'invalid_grant' },
    { fx: 'token-invalid-client', reason: 'invalid_client' },
  ])(
    'maps a 400 $reason to ProviderAuthError without the AADSTS text',
    async (c) => {
      reply(400, fixture(c.fx));
      const err: unknown = await exchangeMicrosoftCode(CLIENT, {
        code: 'secret-code-xyz',
        codeVerifier: VERIFIER,
        redirectUri: 'https://x/cb',
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderAuthError);
      expect(err instanceof ProviderAuthError && err.reason).toBe(c.reason);
      expect(String(err)).not.toContain('AADSTS');
      expect(String(err)).not.toContain('secret-code-xyz');
    },
  );

  it('maps 429 to RateLimitError, 5xx and network failures to TransientError', async () => {
    const input = {
      code: 'c',
      codeVerifier: VERIFIER,
      redirectUri: 'https://x/cb',
    };
    reply(429, null, '5');
    const limited: unknown = await exchangeMicrosoftCode(CLIENT, input).catch(
      (e: unknown) => e,
    );
    expect(limited instanceof RateLimitError && limited.retryAfterMs).toBe(
      5000,
    );
    reply(503, null);
    await expect(exchangeMicrosoftCode(CLIENT, input)).rejects.toBeInstanceOf(
      TransientError,
    );
    post.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(exchangeMicrosoftCode(CLIENT, input)).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it('rejects a 200 without an access token as malformed', async () => {
    reply(200, { token_type: 'Bearer' });
    const input = {
      code: 'c',
      codeVerifier: VERIFIER,
      redirectUri: 'https://x/cb',
    };
    await expect(exchangeMicrosoftCode(CLIENT, input)).rejects.toThrow(
      'malformed_token_response',
    );
  });
});

describe('refreshMicrosoftToken (T3)', () => {
  it('sends the refresh grant with the ruled scopes and returns the ROTATED refresh token', async () => {
    reply(200, fixture('token-rotated'));
    const next = await refreshMicrosoftToken(CLIENT, 'old-refresh', NOW);
    expect(sentForm()).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'old-refresh',
      client_id: 'fake-ms-client-id',
      client_secret: 'fake-secret',
      scope: 'offline_access User.Read Calendars.ReadWrite',
    });
    expect(next.refreshToken).toBe('M.C-FAKE-MS-REFRESH-TOKEN-rotated');
    expect(next.accessToken).toBe('EwB-FAKE-MS-ACCESS-TOKEN-refreshed');
  });

  it('reports a null refresh token when the reply omits one', async () => {
    reply(200, {
      access_token: 'a',
      expires_in: 60,
      scope: 'Calendars.ReadWrite',
    });
    await expect(
      refreshMicrosoftToken(CLIENT, 'old', NOW),
    ).resolves.toMatchObject({
      refreshToken: null,
    });
  });

  it('maps a revoked refresh token (invalid_grant) to ProviderAuthError', async () => {
    reply(400, fixture('token-invalid-grant'));
    await expect(refreshMicrosoftToken(CLIENT, 'old')).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });
});

describe('scope helpers (T4)', () => {
  it('normalises fully-qualified and bare echoes to the same lower-case names', () => {
    expect(
      normalizeMicrosoftScopes([
        'https://graph.microsoft.com/Calendars.ReadWrite',
        'User.Read',
        'openid',
      ]),
    ).toEqual(['calendars.readwrite', 'user.read', 'openid']);
  });

  it.each([
    { scopes: ['https://graph.microsoft.com/Calendars.ReadWrite'], ok: true },
    { scopes: ['Calendars.ReadWrite', 'User.Read'], ok: true },
    { scopes: ['calendars.readwrite'], ok: true },
    { scopes: ['https://graph.microsoft.com/Calendars.Read'], ok: false },
    { scopes: ['User.Read', 'offline_access'], ok: false },
    { scopes: [], ok: false },
  ])('hasMicrosoftCalendarScope($scopes) = $ok', ({ scopes, ok }) => {
    expect(hasMicrosoftCalendarScope(scopes)).toBe(ok);
    expect(missingMicrosoftScopes(scopes)).toEqual(
      ok ? [] : ['Calendars.ReadWrite'],
    );
  });
});

describe('fetchMicrosoftIdentity (T5)', () => {
  const me = (status: number, json: unknown) =>
    jest
      .spyOn(microsoftHttp, 'microsoftJsonRequest')
      .mockResolvedValue({ status, json, retryAfter: null });

  it('reads /me with the access token; a work account is labelled by mail', async () => {
    const spy = me(200, fixture('me-work'));
    await expect(fetchMicrosoftIdentity('tok')).resolves.toEqual({
      id: '00000000-1111-2222-3333-444444444444',
      label: 'raider@contoso.example',
    });
    expect(spy).toHaveBeenCalledWith('GET', MS_ME_URL, 'tok', undefined, {});
  });

  it('labels a personal account (mail null) by userPrincipalName', async () => {
    me(200, fixture('me-personal'));
    await expect(fetchMicrosoftIdentity('tok')).resolves.toEqual({
      id: '0123456789abcdef',
      label: 'raider@outlook.example',
    });
  });

  it('maps a 401 to ProviderAuthError and a body without id to identity_missing', async () => {
    me(401, fixture('error-401'));
    await expect(fetchMicrosoftIdentity('tok')).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
    me(200, { mail: 'x@y.example' });
    await expect(fetchMicrosoftIdentity('tok')).rejects.toThrow(
      'identity_missing',
    );
  });
});
