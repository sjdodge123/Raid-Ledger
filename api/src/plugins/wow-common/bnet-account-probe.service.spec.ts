/**
 * ROK-2129 L2 — BnetAccountProbeService with a fake Blizzard (global fetch
 * spy), fake settings, a Drizzle chain mock for the admin re-check and a spy
 * on the single-use nonce consume. AC6 (url shape), AC7, AC8, AC10, AC11.
 */
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as Sentry from '@sentry/nestjs';
import { BnetProbeResultSchema } from '@raid-ledger/contract';
import * as singleUseToken from '../../auth/single-use-token.helpers';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { BlizzardAuthService } from './blizzard-auth.service';
import { BnetAccountProbeService } from './bnet-account-probe.service';
import { WOW_FOREVER_BNET_PROBE_LAST_RESULT_KEY } from './forever.settings';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const CLIENT = 'https://slot-1.example.test';
const AT = 'AT-SECRET-user-access-token';
const RT = 'RT-SECRET-refresh-token';
const APP_TOKEN = 'APP-SECRET-client-credentials';
const AUTH_CODE = 'CODE-SECRET-authorization-code';
const RETURN = `${CLIENT}/admin/settings/integrations/plugin/blizzard/blizzard-api`;

type Route = (url: string, init: RequestInit) => Response | null;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** A synthetic account summary: `n` characters with realmless hrefs. */
function summaryBody(n: number): unknown {
  const characters = Array.from({ length: n }, (_, i) => ({
    character: {
      href: `https://us.api.blizzard.com/profile/wow/character/hero${i}-forever?namespace=profile-forever-us`,
    },
    name: `Hero${i}`,
    id: 5000 + i,
    realm: { name: 'Secret Realm', slug: 'secret-realm', id: 77 },
  }));
  return { id: 42, wow_accounts: [{ id: 9001, characters }] };
}

const okToken: Route = (url) =>
  url.startsWith('https://oauth.battle.net/token')
    ? json({
        access_token: AT,
        refresh_token: RT,
        expires_in: 86399,
        token_type: 'bearer',
        scope: 'wow.profile',
      })
    : null;

const userSummary =
  (n: number): Route =>
  (url) =>
    url.includes('/profile/user/wow')
      ? url.includes('namespace=profile-forever-us')
        ? json(summaryBody(n))
        : json({}, 404)
      : null;

let db: MockDb;
let settings: { get: jest.Mock; set: jest.Mock; getBlizzardConfig: jest.Mock };
let auth: { getAccessToken: jest.Mock };
let consume: jest.SpyInstance;
let fetchSpy: jest.SpyInstance;
let service: BnetAccountProbeService;

/** Route every fetch through `routes` (first non-null wins; else 404). */
function stubFetch(...routes: Route[]): void {
  fetchSpy.mockImplementation((input: string, init: RequestInit) => {
    for (const route of routes) {
      const res = route(String(input), init);
      if (res) return Promise.resolve(res);
    }
    return Promise.resolve(json({}, 404));
  });
}

/** The urlencoded token-request form (empty when the body is anything else). */
const formOf = (init: RequestInit | undefined): URLSearchParams =>
  init?.body instanceof URLSearchParams ? init.body : new URLSearchParams();

const calls = (part: string): [string, RequestInit][] =>
  fetchSpy.mock.calls.filter((c: [string, RequestInit]) => c[0].includes(part));

/** Start a probe and return the minted state + cookie. */
async function started(): Promise<{ state: string; cookieHash: string }> {
  const { url, cookieValue } = await service.start(7, 'us');
  const state = new URL(url).searchParams.get('state') ?? '';
  return { state, cookieHash: cookieValue };
}

function persisted(): string {
  const call = settings.set.mock.calls.find(
    (c: unknown[]) => c[0] === WOW_FOREVER_BNET_PROBE_LAST_RESULT_KEY,
  );
  return typeof call?.[1] === 'string' ? call[1] : '';
}

beforeEach(async () => {
  process.env.JWT_SECRET = 'unit-test-jwt-secret';
  process.env.CLIENT_URL = CLIENT;
  db = createDrizzleMock();
  db.limit.mockResolvedValue([{ role: 'admin' }]);
  settings = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    getBlizzardConfig: jest
      .fn()
      .mockResolvedValue({ clientId: 'cid', clientSecret: 'csecret' }),
  };
  auth = { getAccessToken: jest.fn().mockResolvedValue(APP_TOKEN) };
  consume = jest
    .spyOn(singleUseToken, 'consumeTokenOnce')
    .mockResolvedValue(true);
  fetchSpy = jest.spyOn(globalThis, 'fetch');
  stubFetch(okToken, userSummary(2));
  const moduleRef = await Test.createTestingModule({
    providers: [
      BnetAccountProbeService,
      { provide: SettingsService, useValue: settings },
      { provide: BlizzardAuthService, useValue: auth },
      { provide: DrizzleAsyncProvider, useValue: db },
    ],
  }).compile();
  service = moduleRef.get(BnetAccountProbeService);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(Sentry.captureException).mockReset();
});

describe('BnetAccountProbeService.start (AC6)', () => {
  it('builds the oauth.battle.net consent URL with PKCE S256 and the /api callback', async () => {
    const { url, cookieValue } = await service.start(7, 'us');
    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(
      'https://oauth.battle.net/authorize',
    );
    const p = Object.fromEntries(parsed.searchParams);
    expect(p).toMatchObject({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: `${CLIENT}/api/plugins/blizzard/bnet-account-probe/callback`,
      scope: 'wow.profile',
      code_challenge_method: 'S256',
    });
    expect(p.state?.length).toBeGreaterThan(20);
    expect(p.code_challenge?.length).toBe(43);
    expect(cookieValue.length).toBe(43);
  });

  it('getState reports the same redirectUri and a null result', async () => {
    await expect(service.getState()).resolves.toEqual({
      redirectUri: `${CLIENT}/api/plugins/blizzard/bnet-account-probe/callback`,
      result: null,
    });
  });
});

describe('BnetAccountProbeService.handleCallback — happy path (AC7)', () => {
  it('exchanges with PKCE + Basic auth, asks four namespaces, persists, 302s ok', async () => {
    const { state, cookieHash } = await started();
    const location = await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    expect(location).toBe(`${RETURN}?bnetProbe=ok`);
    const [tokenCall] = calls('oauth.battle.net/token');
    const form = formOf(tokenCall?.[1]);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe(AUTH_CODE);
    expect(form.get('code_verifier')?.length).toBe(43);
    const headers = new Headers(tokenCall?.[1].headers);
    expect(headers.get('authorization')).toBe(
      `Basic ${Buffer.from('cid:csecret').toString('base64')}`,
    );
    const summaries = calls('/profile/user/wow');
    expect(
      summaries.map((c) => new URL(c[0]).searchParams.get('namespace')),
    ).toEqual([
      'profile-forever-us',
      'profile-classic1x-us',
      'profile-classic-us',
      'profile-us',
    ]);
    expect(new Headers(summaries[0]?.[1].headers).get('authorization')).toBe(
      `Bearer ${AT}`,
    );
    const result = BnetProbeResultSchema.parse(JSON.parse(persisted()));
    expect(result.error).toBeNull();
    expect(result.token).toMatchObject({
      refreshTokenIssued: true,
      expiresIn: 86399,
      pkceAccepted: true,
    });
    expect(result.namespaces.map((n) => n.status)).toEqual([
      200, 404, 404, 404,
    ]);
    expect(result.namespaces[0]?.summary?.characterCount).toBe(2);
  });
});

describe('BnetAccountProbeService.handleCallback — state misses (AC8)', () => {
  async function expectStateMiss(
    query: Record<string, unknown>,
    cookieHash: string | undefined,
  ): Promise<void> {
    const location = await service.handleCallback({ query, cookieHash });
    expect(location).toBe(`${RETURN}?bnetProbe=error&code=state`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalled();
  }

  it('tampered state', async () => {
    const { state, cookieHash } = await started();
    await expectStateMiss({ state: `${state}x`, code: AUTH_CODE }, cookieHash);
  });

  it('wrong browser cookie', async () => {
    const { state } = await started();
    await expectStateMiss({ state, code: AUTH_CODE }, 'not-the-cookie');
  });

  it('replayed nonce', async () => {
    const { state, cookieHash } = await started();
    consume.mockResolvedValue(false);
    await expectStateMiss({ state, code: AUTH_CODE }, cookieHash);
  });

  it('uid no longer an admin', async () => {
    const { state, cookieHash } = await started();
    db.limit.mockResolvedValue([{ role: 'member' }]);
    await expectStateMiss({ state, code: AUTH_CODE }, cookieHash);
  });

  it('missing state', async () => {
    await expectStateMiss({ code: AUTH_CODE }, 'whatever');
  });
});

describe('BnetAccountProbeService.handleCallback — provider + exchange errors', () => {
  it('access_denied → denied, recorded, no Blizzard call', async () => {
    const { state, cookieHash } = await started();
    const location = await service.handleCallback({
      query: { state, error: 'access_denied' },
      cookieHash,
    });
    expect(location).toBe(`${RETURN}?bnetProbe=error&code=denied`);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.parse(persisted())).toMatchObject({
      error: 'denied',
      token: null,
    });
  });

  it('token non-2xx → exchange, token summary recorded, no summary calls', async () => {
    stubFetch((url) =>
      url.includes('/token') ? json({ error: 'invalid_grant' }, 400) : null,
    );
    const { state, cookieHash } = await started();
    const location = await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    expect(location).toBe(`${RETURN}?bnetProbe=error&code=exchange`);
    expect(calls('/profile/user/wow')).toHaveLength(0);
    expect(JSON.parse(persisted())).toMatchObject({
      error: 'exchange',
      token: { status: 400, keys: ['error'] },
    });
  });
});

describe('BnetAccountProbeService.handleCallback — PKCE retry + internal errors', () => {
  it('a PKCE complaint retries once without code_verifier and records pkceAccepted:false (F3)', async () => {
    let tokenCalls = 0;
    const pkceThenOk: Route = (url, init) => {
      if (!url.includes('/token')) return null;
      tokenCalls += 1;
      const hasVerifier = formOf(init).has('code_verifier');
      return hasVerifier
        ? json(
            {
              error: 'invalid_request',
              error_description: 'code_verifier not supported',
            },
            400,
          )
        : json({ access_token: AT, expires_in: 60 });
    };
    stubFetch(pkceThenOk, userSummary(1));
    const { state, cookieHash } = await started();
    await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    expect(tokenCalls).toBe(2);
    expect(JSON.parse(persisted())).toMatchObject({
      error: null,
      token: { pkceAccepted: false },
    });
  });

  it('a thrown internal error → unavailable, Sentry gets no secret', async () => {
    const { state, cookieHash } = await started();
    settings.getBlizzardConfig.mockRejectedValue(
      new Error(`boom ${AUTH_CODE} ${state}`),
    );
    const location = await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    expect(location).toBe(`${RETURN}?bnetProbe=error&code=unavailable`);
    const sent = JSON.stringify(
      jest.mocked(Sentry.captureException).mock.calls.map((c) => String(c[0])),
    );
    expect(sent).toContain('bnet account probe failed: Error');
    expect(sent).not.toContain(AUTH_CODE);
    expect(sent).not.toContain(state);
  });
});

describe('BnetAccountProbeService — ID parity (AC10)', () => {
  it('checks exactly 10 of 12 characters and counts match / mismatch / 404 / 500', async () => {
    const outcomes = [
      200,
      200,
      200,
      200,
      'mismatch',
      'mismatch',
      404,
      404,
      500,
      500,
    ];
    let seen = 0;
    const appAuth: (string | null)[] = [];
    const characterRoute: Route = (url, init) => {
      if (!url.includes('/profile/wow/character/')) return null;
      appAuth.push(new Headers(init.headers).get('authorization'));
      const i = seen;
      seen += 1;
      const o = outcomes[i];
      if (o === 200) return json({ id: 5000 + i });
      if (o === 'mismatch') return json({ id: 1 });
      return json({}, typeof o === 'number' ? o : 500);
    };
    stubFetch(okToken, userSummary(12), characterRoute);
    const { state, cookieHash } = await started();
    await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    expect(calls('/profile/wow/character/')).toHaveLength(10);
    expect(new Set(appAuth)).toEqual(new Set([`Bearer ${APP_TOKEN}`]));
    expect(JSON.parse(persisted()).idParity).toEqual({
      checked: 10,
      matched: 4,
      mismatched: 2,
      notFound: 2,
      errors: 2,
      viaHref: 10,
      viaName: 0,
    });
  });
});

describe('BnetAccountProbeService — no secret leaves the request (AC11)', () => {
  it('no log line, persisted value or Sentry payload carries a token, code, state or name', async () => {
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => {
          logged.push(JSON.stringify(args));
        });
    }
    const { state, cookieHash } = await started();
    await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash,
    });
    await service.handleCallback({
      query: { state, code: AUTH_CODE },
      cookieHash: 'x',
    });
    const haystack = [
      persisted(),
      ...logged,
      JSON.stringify(jest.mocked(Sentry.captureException).mock.calls),
    ].join('\n');
    expect(persisted().length).toBeGreaterThan(0);
    for (const secret of [
      AT,
      RT,
      APP_TOKEN,
      AUTH_CODE,
      state,
      cookieHash,
      'Hero0',
      'Secret Realm',
      'secret-realm',
      '5000',
      '9001',
    ]) {
      expect(haystack).not.toContain(secret);
    }
  });
});
