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

async function mintNonce(provider: Provider, body: object = {}) {
  const res = await start(provider, adminToken, body);
  expect(res.status).toBe(200);
  return (res.body as { nonce: string }).nonce;
}

function hop(provider: Provider, query: Record<string, string>) {
  return testApp.request.get(`/auth/${provider}/link`).query(query);
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
    const res = await hop('discord', { nonce: await mintNonce('discord') });

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
      const res = await hop('steam', { nonce: await mintNonce('steam', body) });

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

type MissQuery = (p: Provider) => Promise<Record<string, string>>;

const other = (p: Provider): Provider =>
  p === 'discord' ? 'steam' : 'discord';

const MISSES: [string, MissQuery][] = [
  [
    'a replayed nonce',
    async (p) => {
      const nonce = await mintNonce(p);
      expect((await hop(p, { nonce })).headers.location).not.toBe(
        errorLanding(p),
      );
      return { nonce };
    },
  ],
  [
    'an expired nonce',
    (p) =>
      Promise.resolve({
        nonce: signPurposeJwt(
          signer,
          `link-nonce:${p}`,
          {
            sub: testApp.seed.adminUser.id,
            iat: Math.floor(Date.now() / 1000) - 600,
          },
          LINK_NONCE_TTL_SECONDS,
        ),
      }),
  ],
  [
    'a cross-provider nonce',
    async (p) => ({ nonce: await mintNonce(other(p)) }),
  ],
  ['a missing nonce', () => Promise.resolve({})],
  ['a garbage nonce', () => Promise.resolve({ nonce: 'garbage' })],
  [
    'a legacy ?token=<access JWT>',
    () => Promise.resolve({ token: adminToken }),
  ],
];

describe.each(PROVIDERS)('GET /auth/%s/link misses (AC14)', (p) => {
  it.each(MISSES)(
    '%s → the error-landing 302, user row unchanged',
    async (_label, build) => {
      const query = await build(p);
      const before = await adminRow();

      const res = await hop(p, query);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(errorLanding(p));
      expect(res.headers['content-type'] ?? '').not.toContain(
        'application/json',
      );
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
