/**
 * ROK-1630 (inside ROK-1366) — link initiators without `?token=`
 * (integration, real DB). Covers ACs 11–15.
 *
 *   POST /auth/{discord,steam}/link/start  → {nonce, expiresIn}, Bearer only
 *   GET  /auth/{discord,steam}/link?nonce= → 302 to the provider, once
 *
 * Every GET-hop miss (replay, expired, cross-provider, missing, garbage,
 * legacy `?token=`) must be the SAME 302 to the profile error landing with
 * the operator-ruled copy (OQ4), and must not touch the user row.
 *
 * PR #1384 follow-up: /link/start also sets `rl_link_<provider>` =
 * sha256(nonce), and the hop only honours a nonce from the browser holding
 * that cookie — a forwarded nonce (no/other cookie) is the same miss.
 *
 * Discord OAuth config is stubbed on the app's SettingsService instance (the
 * one DiscordAuthController holds); Steam is configured for real via
 * `setSteamApiKey`, as `steam-auth.integration.spec.ts` does. supertest does
 * not follow redirects, so each 302's Location is read directly.
 */
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { DiscordAuthController } from '../plugins/discord/discord-auth.controller';
import { SettingsService } from '../settings/settings.service';
import { SteamAuthController } from '../steam/steam-auth.controller';
import { LINK_NONCE_TTL_SECONDS } from './link-nonce.service';
import { MagicLinkService } from './magic-link.service';
import { signPurposeJwt } from './purpose-jwt.helpers';

type Provider = 'discord' | 'steam';
const PROVIDERS: Provider[] = ['discord', 'steam'];

/** OQ4 copy, URL-encoded exactly as both GET hops emit it. */
const EXPIRED_COPY = 'Link%20request%20expired.%20Please%20try%20again.';

const DISCORD_OAUTH = {
  clientId: 'link-start-client-id',
  clientSecret: 'link-start-client-secret',
  callbackUrl: 'http://localhost:3000/auth/discord/callback',
};

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  jest
    .spyOn(testApp.app.get(SettingsService), 'getDiscordOAuthConfig')
    .mockResolvedValue(DISCORD_OAUTH);
  await testApp.app.get(SettingsService).setSteamApiKey('link-start-steam-key');
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

const signer = new JwtService();

function clientUrl(): string {
  return testApp.app.get(ConfigService).get<string>('CLIENT_URL') as string;
}

/** The one Location every GET-hop miss must produce. */
function errorLanding(provider: Provider): string {
  const flag = provider === 'discord' ? 'linked' : 'steam';
  return `${clientUrl()}/profile/integrations?${flag}=error&message=${EXPIRED_COPY}`;
}

function start(provider: Provider, bearer?: string, body?: object) {
  const req = testApp.request.post(`/auth/${provider}/link/start`);
  if (bearer) req.set('Authorization', `Bearer ${bearer}`);
  return body === undefined ? req : req.send(body);
}

const cookieName = (p: Provider) => `rl_link_${p}`;
const sha256 = (v: string) =>
  crypto.createHash('sha256').update(v).digest('hex');

/** The `Cookie:` header a browser holding `nonce`'s binding would send. */
const boundCookie = (p: Provider, nonce: string) =>
  `${cookieName(p)}=${sha256(nonce)}`;

/** The response's Set-Cookie line for `rl_link_<p>`, if any. */
function linkSetCookie(
  res: { headers: Record<string, unknown> },
  p: Provider,
): string | undefined {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return lines.find((l) => l.startsWith(`${cookieName(p)}=`));
}

/** Mint via POST /link/start; returns the nonce + the cookie it set. */
async function mintBound(provider: Provider, body: object = {}) {
  const res = await start(provider, adminToken, body);
  expect(res.status).toBe(200);
  const nonce = (res.body as { nonce: string }).nonce;
  const setCookie = linkSetCookie(res, provider);
  expect(setCookie).toBeDefined();
  return { nonce, cookie: (setCookie as string).split(';')[0] };
}

async function mintNonce(provider: Provider, body: object = {}) {
  return (await mintBound(provider, body)).nonce;
}

function hop(
  provider: Provider,
  query: Record<string, string>,
  cookie?: string,
) {
  const req = testApp.request.get(`/auth/${provider}/link`).query(query);
  return cookie ? req.set('Cookie', cookie) : req;
}

/** Decode a `{data, signature}` OAuth state and check its HMAC (JWT_SECRET). */
function decodeSignedState(state: string): Record<string, unknown> {
  const { data, signature } = JSON.parse(
    Buffer.from(state, 'base64').toString(),
  ) as { data: string; signature: string };
  const secret = testApp.app.get(ConfigService).get<string>('JWT_SECRET');
  const expected = crypto
    .createHmac('sha256', secret as string)
    .update(data)
    .digest('hex');
  expect(signature).toBe(expected);
  return JSON.parse(data) as Record<string, unknown>;
}

async function adminRow() {
  const [row] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, testApp.seed.adminUser.id));
  return row;
}

async function magicToken(): Promise<string> {
  const link = await testApp.app
    .get(MagicLinkService)
    .generateLink(testApp.seed.adminUser.id, '/profile', clientUrl());
  return decodeURIComponent(new URL(link as string).hash.slice(7));
}

// ── AC11 + AC12 — POST /auth/{provider}/link/start ──────────────────────────

describe.each(PROVIDERS)('POST /auth/%s/link/start (AC11, AC12)', (p) => {
  it('is 401 without a Bearer token', async () => {
    const res = await start(p, undefined, {});
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('nonce');
  });

  it('is 401 with a magic-link token as the Bearer', async () => {
    const res = await start(p, await magicToken(), {});
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty('nonce');
  });

  it.each<[string, object | undefined]>([
    ['an empty object', {}],
    ['no body at all', undefined],
  ])('returns {nonce, expiresIn:120} for %s', async (_label, body) => {
    const res = await start(p, adminToken, body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      nonce: expect.any(String),
      expiresIn: LINK_NONCE_TTL_SECONDS,
    });
    expect(LINK_NONCE_TTL_SECONDS).toBe(120);
  });

  it.each<[string, () => object]>([
    ['a token field', () => ({ token: adminToken })],
    ['an unknown key', () => ({ extra: true })],
    ['returnTo over 64 characters', () => ({ returnTo: `/${'a'.repeat(64)}` })],
  ])('is 400 for a body carrying %s', async (_label, body) => {
    const res = await start(p, adminToken, body());
    expect(res.status).toBe(400);
    expect(res.body).not.toHaveProperty('nonce');
  });

  it('never reads a token from the query string', async () => {
    const res = await testApp.request
      .post(`/auth/${p}/link/start`)
      .query({ token: adminToken })
      .send({});
    expect(res.status).toBe(401);
  });
});

// ── AC13 — a fresh nonce reaches the provider with today's signed state ─────

describe('GET /auth/discord/link?nonce= (AC13)', () => {
  it('302s to Discord authorize with a signed {userId, action:link} state', async () => {
    const { nonce, cookie } = await mintBound('discord');
    const res = await hop('discord', { nonce }, cookie);

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(`${loc.origin}${loc.pathname}`).toBe(
      'https://discord.com/api/oauth2/authorize',
    );
    expect(loc.searchParams.get('client_id')).toBe(DISCORD_OAUTH.clientId);
    expect(loc.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/discord/link/callback',
    );
    const state = decodeSignedState(loc.searchParams.get('state') as string);
    expect(state).toMatchObject({
      userId: testApp.seed.adminUser.id,
      action: 'link',
    });
  });
});

describe('GET /auth/steam/link?nonce= (AC11, AC13)', () => {
  it.each<[string, string | undefined, string]>([
    ['/onboarding', '/onboarding', '/onboarding'],
    ['/profile', '/profile', '/profile'],
    ['an off-allowlist URL', 'https://evil.example/x', '/profile'],
    ['no returnTo', undefined, '/profile'],
  ])(
    'returnTo %s binds %s into the signed state',
    async (_l, returnTo, want) => {
      const body = returnTo === undefined ? {} : { returnTo };
      const { nonce, cookie } = await mintBound('steam', body);
      const res = await hop('steam', { nonce }, cookie);

      expect(res.status).toBe(302);
      const loc = new URL(res.headers.location);
      expect(`${loc.origin}${loc.pathname}`).toBe(
        'https://steamcommunity.com/openid/login',
      );
      const back = new URL(loc.searchParams.get('openid.return_to') as string);
      expect(back.pathname).toBe('/auth/steam/link/callback');
      const state = decodeSignedState(back.searchParams.get('state') as string);
      expect(state).toMatchObject({
        userId: testApp.seed.adminUser.id,
        action: 'steam_link',
        returnTo: want,
      });
    },
  );
});

// ── AC14 — every miss is the same error 302 and changes nothing ──────────────

/** A miss: the query plus the Cookie header its browser sends (if any). */
type Miss = { query: Record<string, string>; cookie?: string };
type MissQuery = (p: Provider) => Promise<Miss>;

const other = (p: Provider): Provider =>
  p === 'discord' ? 'steam' : 'discord';

/** A nonce with the matching cookie — so only the nonce check can reject. */
const withBinding = (p: Provider, nonce: string): Miss => ({
  query: { nonce },
  cookie: boundCookie(p, nonce),
});

const MISSES: [string, MissQuery][] = [
  [
    'a replayed nonce (same browser, cookie re-sent)',
    async (p) => {
      const { nonce, cookie } = await mintBound(p);
      expect((await hop(p, { nonce }, cookie)).headers.location).not.toBe(
        errorLanding(p),
      );
      return { query: { nonce }, cookie };
    },
  ],
  [
    'an expired nonce',
    (p) =>
      Promise.resolve(
        withBinding(
          p,
          signPurposeJwt(
            signer,
            `link-nonce:${p}`,
            {
              sub: testApp.seed.adminUser.id,
              iat: Math.floor(Date.now() / 1000) - 600,
            },
            LINK_NONCE_TTL_SECONDS,
          ),
        ),
      ),
  ],
  [
    'a cross-provider nonce',
    async (p) => withBinding(p, await mintNonce(other(p))),
  ],
  ['a missing nonce', () => Promise.resolve({ query: {} })],
  ['a garbage nonce', (p) => Promise.resolve(withBinding(p, 'garbage'))],
  [
    'a legacy ?token=<access JWT>',
    () => Promise.resolve({ query: { token: adminToken } }),
  ],
  [
    'a fresh nonce forwarded to a browser with no cookie',
    async (p) => ({ query: { nonce: await mintNonce(p) } }),
  ],
  [
    "a fresh nonce presented with another nonce's cookie",
    async (p) => ({
      query: { nonce: await mintNonce(p) },
      cookie: (await mintBound(p)).cookie,
    }),
  ],
  [
    "a fresh nonce presented with the other provider's cookie",
    async (p) => {
      const { nonce } = await mintBound(p);
      return { query: { nonce }, cookie: boundCookie(other(p), nonce) };
    },
  ],
];

describe.each(PROVIDERS)('GET /auth/%s/link misses (AC14)', (p) => {
  it.each(MISSES)(
    '%s → the error-landing 302, user row unchanged',
    async (_label, build) => {
      const { query, cookie } = await build(p);
      const before = await adminRow();

      const res = await hop(p, query, cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(errorLanding(p));
      expect(res.headers['content-type'] ?? '').not.toContain(
        'application/json',
      );
      expect(await adminRow()).toEqual(before);
    },
  );
});

// ── PR #1384 follow-up — the nonce is bound to the minting browser ─────────

describe.each(PROVIDERS)('%s link nonce browser binding', (p) => {
  it('POST /link/start sets an httpOnly, Lax, 120s cookie of sha256(nonce)', async () => {
    const res = await start(p, adminToken, {});
    const nonce = (res.body as { nonce: string }).nonce;
    const setCookie = linkSetCookie(res, p) ?? '';

    expect(setCookie.split(';')[0]).toBe(boundCookie(p, nonce));
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/);
    expect(setCookie).toMatch(/;\s*Max-Age=120(;|$)/);
    expect(setCookie).not.toContain(nonce);
  });

  it('a forwarded (cookie-less) hop does not spend the nonce', async () => {
    const { nonce, cookie } = await mintBound(p);

    const forwarded = await hop(p, { nonce });
    expect(forwarded.headers.location).toBe(errorLanding(p));

    const owner = await hop(p, { nonce }, cookie);
    expect(owner.status).toBe(302);
    expect(owner.headers.location).not.toBe(errorLanding(p));
  });

  it('a matched hop clears the cookie', async () => {
    const { nonce, cookie } = await mintBound(p);

    const res = await hop(p, { nonce }, cookie);

    expect(res.headers.location).not.toBe(errorLanding(p));
    const cleared = linkSetCookie(res, p) ?? '';
    expect(cleared.split(';')[0]).toBe(`${cookieName(p)}=`);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

// ── PR #1384 review — the signed state is bound to the hop browser ─────────

/** The signed state a matched hop put in its 302 (Discord or Steam shape). */
function hopState(p: Provider, location: string): string {
  const loc = new URL(location);
  if (p === 'discord') return loc.searchParams.get('state') as string;
  const back = new URL(loc.searchParams.get('openid.return_to') as string);
  return back.searchParams.get('state') as string;
}

function stateSetCookie(
  res: { headers: Record<string, unknown> },
  p: Provider,
) {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  return lines.find((l) => l.startsWith(`rl_link_state_${p}=`));
}

/** The attacker's own matched hop: the state its 302 carries. */
async function boundHop(p: Provider) {
  const { nonce, cookie } = await mintBound(p);
  const res = await hop(p, { nonce }, cookie);
  expect(res.status).toBe(302);
  return { res, state: hopState(p, res.headers.location) };
}

function callback(p: Provider, state: string, cookie?: string) {
  const query = p === 'discord' ? { code: 'forwarded-code', state } : { state };
  const req = testApp.request.get(`/auth/${p}/link/callback`).query(query);
  return cookie ? req.set('Cookie', cookie) : req;
}

/** Where a callback refused as unbound lands (returnTo defaults to /profile). */
function callbackExpired(p: Provider): string {
  const flag = p === 'discord' ? 'linked' : 'steam';
  return `${clientUrl()}/profile?${flag}=error&message=${EXPIRED_COPY}`;
}

describe.each(PROVIDERS)('%s link callback state binding', (p) => {
  it('a matched hop sets an httpOnly, Lax, 10-minute cookie of sha256(state.r)', async () => {
    const { res, state } = await boundHop(p);
    const r = decodeSignedState(state).r;
    const setCookie = stateSetCookie(res, p) ?? '';

    expect(typeof r).toBe('string');
    expect(setCookie.split(';')[0]).toBe(
      `rl_link_state_${p}=${sha256(r as string)}`,
    );
    expect(setCookie).toMatch(/;\s*HttpOnly/i);
    expect(setCookie).toMatch(/;\s*SameSite=Lax/i);
    expect(setCookie).toMatch(/;\s*Path=\/(;|$)/);
    expect(setCookie).toMatch(/;\s*Max-Age=600(;|$)/);
  });

  it.each<[string, string | undefined]>([
    ['with no state cookie (a forwarded provider URL)', undefined],
    [
      'with a state cookie for a different r',
      `rl_link_state_${p}=${sha256('x')}`,
    ],
  ])(
    'refuses a valid state %s and leaves the user row alone',
    async (_l, cookie) => {
      const { state } = await boundHop(p);
      const before = await adminRow();

      const res = await callback(p, state, cookie);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(callbackExpired(p));
      expect(await adminRow()).toEqual(before);
    },
  );
});

// ── AC15 — neither GET hop can read ?token= ──────────────────────────────────

/** The `data` of every route-param decorator on a handler, e.g. 'nonce'. */
function routeParamNames(ctrl: object, method: string): unknown[] {
  const meta = (Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, method) ??
    {}) as Record<string, { data?: unknown }>;
  return Object.values(meta).map((m) => m.data);
}

describe('GET link handlers take no token (AC15)', () => {
  it.each<[string, object, string]>([
    ['DiscordAuthController.discordLink', DiscordAuthController, 'discordLink'],
    ['SteamAuthController.steamLink', SteamAuthController, 'steamLink'],
  ])('%s declares @Query(nonce), not @Query(token)', (_l, ctrl, method) => {
    const names = routeParamNames(ctrl, method);
    expect(names).toContain('nonce');
    expect(names).not.toContain('token');
  });
});
