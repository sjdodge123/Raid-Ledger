/**
 * ROK-1592: Google OAuth helpers — exact request shapes, error mapping,
 * id_token claim checks, and that no error ever carries a secret.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as googleHttp from './google-http';
import {
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  missingGoogleScopes,
  parseGoogleIdToken,
  refreshGoogleToken,
  revokeGoogleToken,
} from './google-oauth.helpers';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';

type Json = Record<string, unknown>;
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as Json;

const CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
const SECRET = 'GOCSPX-secret-sentinel';
const CLIENT = { clientId: CLIENT_ID, clientSecret: SECRET };
const CODE = 'auth-code-sentinel';
const VERIFIER = 'verifier-sentinel';
const REDIRECT =
  'https://slot-1.gamernight.net/api/calendar-sync/oauth/google/callback';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const OK = fixture('token-ok');
const SECRETS = [
  SECRET,
  CODE,
  VERIFIER,
  String(OK.access_token),
  String(OK.refresh_token),
];

let post: jest.SpyInstance;
beforeEach(() => {
  post = jest.spyOn(googleHttp, 'googleFormPost');
});
afterEach(() => jest.restoreAllMocks());

const reply = (
  status: number,
  json: unknown,
  retryAfter: string | null = null,
) => post.mockResolvedValueOnce({ status, json, retryAfter });

const exchange = () =>
  exchangeGoogleCode(
    CLIENT,
    { code: CODE, codeVerifier: VERIFIER, redirectUri: REDIRECT },
    NOW,
  );

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to reject');
}

function expectNoSecrets(err: Error): void {
  for (const secret of SECRETS) {
    expect(String(err)).not.toContain(secret);
    expect(JSON.stringify(err)).not.toContain(secret);
  }
}

describe('GOOGLE_CONNECT_SCOPES', () => {
  it('is exactly the ruled scope set (OPERATOR-1)', () => {
    expect(GOOGLE_CONNECT_SCOPES).toBe(
      'openid email https://www.googleapis.com/auth/calendar.app.created',
    );
  });
});

describe('buildGoogleAuthUrl', () => {
  it('builds the exact authorize URL', () => {
    const url = buildGoogleAuthUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT,
      state: 'st.ate',
      codeChallenge: 'chal_lenge-1',
    });
    expect(url).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth' +
        '?client_id=fake-client-id.apps.googleusercontent.com' +
        '&redirect_uri=https%3A%2F%2Fslot-1.gamernight.net%2Fapi%2Fcalendar-sync%2Foauth%2Fgoogle%2Fcallback' +
        '&response_type=code' +
        '&scope=openid+email+https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fcalendar.app.created' +
        '&access_type=offline&prompt=consent&include_granted_scopes=true' +
        '&state=st.ate&code_challenge=chal_lenge-1&code_challenge_method=S256',
    );
    expect(new URL(url).searchParams.get('scope')).toBe(GOOGLE_CONNECT_SCOPES);
  });
});

describe('exchangeGoogleCode', () => {
  it('posts the PKCE code grant and parses the token set', async () => {
    reply(200, OK);
    const tokens = await exchange();
    expect(post).toHaveBeenCalledWith(
      GOOGLE_TOKEN_URL,
      {
        grant_type: 'authorization_code',
        code: CODE,
        client_id: CLIENT_ID,
        client_secret: SECRET,
        redirect_uri: REDIRECT,
        code_verifier: VERIFIER,
      },
      { timeoutMs: undefined },
    );
    expect(tokens).toEqual({
      accessToken: OK.access_token,
      refreshToken: OK.refresh_token,
      expiresAt: new Date(NOW + 3599 * 1000).toISOString(),
      scopes: String(OK.scope).split(' '),
      idToken: OK.id_token,
    });
  });

  it('returns refreshToken null when Google omits it', async () => {
    reply(200, fixture('token-no-refresh'));
    expect((await exchange()).refreshToken).toBeNull();
  });
});

describe('exchangeGoogleCode error mapping', () => {
  it('maps 400 invalid_grant to ProviderAuthError', async () => {
    reply(400, fixture('token-400'));
    const err = await caught(exchange());
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect((err as ProviderAuthError).reason).toBe('invalid_grant');
    expectNoSecrets(err);
  });

  it('maps 5xx to TransientError', async () => {
    reply(503, null);
    const err = await caught(exchange());
    expect(err).toBeInstanceOf(TransientError);
    expect((err as TransientError).reason).toBe('http_503');
  });

  it('maps 429 to RateLimitError with Retry-After in ms', async () => {
    reply(429, { error: 'rate_limit_exceeded' }, '30');
    const err = await caught(exchange());
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(30_000);
  });

  it('maps a network failure and a timeout to TransientError', async () => {
    post.mockRejectedValueOnce(new TypeError(`fetch failed ${SECRET}`));
    const net = await caught(exchange());
    expect(net).toBeInstanceOf(TransientError);
    expect((net as TransientError).reason).toBe('network');
    expectNoSecrets(net);
    post.mockRejectedValueOnce(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' }),
    );
    expect(((await caught(exchange())) as TransientError).reason).toBe(
      'timeout',
    );
  });

  it('never echoes error_description or an unsafe error code', async () => {
    reply(400, { error: 'invalid_grant', error_description: `bad ${SECRET}` });
    expectNoSecrets(await caught(exchange()));
    reply(401, { error: `${CODE} ${SECRET}` });
    const err = await caught(exchange());
    expect((err as ProviderAuthError).reason).toBe('http_401');
    expectNoSecrets(err);
  });

  it('rejects a 200 without an access token', async () => {
    reply(200, { scope: 'openid' });
    const err = await caught(exchange());
    expect((err as ProviderAuthError).reason).toBe('malformed_token_response');
  });
});

describe('refreshGoogleToken', () => {
  it('posts the refresh grant', async () => {
    reply(200, fixture('token-no-refresh'));
    const tokens = await refreshGoogleToken(CLIENT, 'rt-sentinel', NOW);
    expect(post).toHaveBeenCalledWith(
      GOOGLE_TOKEN_URL,
      {
        grant_type: 'refresh_token',
        refresh_token: 'rt-sentinel',
        client_id: CLIENT_ID,
        client_secret: SECRET,
      },
      { timeoutMs: undefined },
    );
    expect(tokens.refreshToken).toBeNull();
  });

  it('maps invalid_grant on refresh to ProviderAuthError', async () => {
    reply(400, fixture('token-400'));
    const err = await caught(refreshGoogleToken(CLIENT, 'rt-sentinel', NOW));
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect(String(err)).not.toContain('rt-sentinel');
  });
});

describe('revokeGoogleToken', () => {
  it('posts the token with a 5 s timeout', async () => {
    reply(200, null);
    await revokeGoogleToken('rt-sentinel');
    expect(post).toHaveBeenCalledWith(
      GOOGLE_REVOKE_URL,
      { token: 'rt-sentinel' },
      { timeoutMs: 5_000 },
    );
  });

  it('treats 400 invalid_token (already revoked) as success', async () => {
    reply(400, { error: 'invalid_token' });
    await expect(revokeGoogleToken('rt-sentinel')).resolves.toBeUndefined();
  });

  it('maps a 500 to TransientError without the token', async () => {
    reply(500, null);
    const err = await caught(revokeGoogleToken('rt-sentinel'));
    expect(err).toBeInstanceOf(TransientError);
    expect(String(err)).not.toContain('rt-sentinel');
  });
});

describe('parseGoogleIdToken', () => {
  const ID_TOKEN = String(OK.id_token);
  const [head, , sig] = ID_TOKEN.split('.');
  const claims = JSON.parse(
    Buffer.from(ID_TOKEN.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Json;
  const withClaims = (patch: Json): string =>
    [
      head,
      Buffer.from(JSON.stringify({ ...claims, ...patch })).toString(
        'base64url',
      ),
      sig,
    ].join('.');
  const reasonOf = (token: string): string => {
    try {
      parseGoogleIdToken(token, CLIENT_ID, NOW);
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderAuthError);
      expect(String(err)).not.toContain(token);
      return (err as ProviderAuthError).reason;
    }
    return 'accepted';
  };

  it('returns sub and email from a valid token', () => {
    expect(parseGoogleIdToken(ID_TOKEN, CLIENT_ID, NOW)).toEqual({
      sub: '109876543210987654321',
      email: 'raider@example.test',
    });
  });

  it('accepts the bare issuer and a missing email', () => {
    const token = withClaims({ iss: 'accounts.google.com', email: undefined });
    expect(parseGoogleIdToken(token, CLIENT_ID, NOW).email).toBeNull();
  });

  it('rejects a foreign issuer, audience, expiry, subject and format', () => {
    expect(reasonOf(withClaims({ iss: 'https://evil.example' }))).toBe(
      'id_token_iss',
    );
    expect(reasonOf(withClaims({ aud: 'other-client' }))).toBe('id_token_aud');
    expect(reasonOf(withClaims({ exp: NOW / 1000 - 1 }))).toBe('id_token_exp');
    expect(reasonOf(withClaims({ exp: undefined }))).toBe('id_token_exp');
    expect(reasonOf(withClaims({ sub: '' }))).toBe('id_token_sub');
    expect(reasonOf('only.two')).toBe('id_token_format');
    expect(reasonOf('a.!!notjson.c')).toBe('id_token_payload');
  });
});

describe('missingGoogleScopes', () => {
  it('flags a grant without calendar.app.created', () => {
    const granted = String(fixture('token-missing-scope').scope).split(' ');
    expect(missingGoogleScopes(granted)).toEqual([
      'https://www.googleapis.com/auth/calendar.app.created',
    ]);
    expect(missingGoogleScopes(String(OK.scope).split(' '))).toEqual([]);
  });
});
