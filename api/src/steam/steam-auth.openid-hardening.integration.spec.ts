/**
 * ROK-1731 — Steam OpenID callback hardening (integration, real DB +
 * redis-mock). Drives the real link flow over HTTP:
 *
 *   POST /auth/steam/link/start → GET /auth/steam/link?nonce= (302 to Steam)
 *   → GET /auth/steam/link/callback?<assertion>&state=
 *
 * The real validator, nonce store (on the harness's redis-mock) and
 * `verifySteamOpenId` run. Only `global.fetch` is stubbed, for Steam's
 * `check_authentication` POST and GetPlayerSummaries; every other fetch
 * passes through. supertest does not follow redirects, so each 302's
 * Location and headers are read directly.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { STEAM_OPENID_URL } from './steam-http.util';
import { STEAM_OPENID_NS } from './steam-openid-assertion.helpers';
import { steamNonceKey } from './steam-openid-nonce.store';

const STEAM_ID = '76561198000000077';
const CLAIMED = `https://steamcommunity.com/openid/id/${STEAM_ID}`;
const SIGNED =
  'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle';
const FAILED = 'steam=error&message=Steam%20verification%20failed';

let testApp: TestApp;
let token: string;
let fetchSpy: jest.SpyInstance;
const realFetch = global.fetch;

/** Steam says is_valid:true; the profile lookup finds no player (private). */
function fakeSteam(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith(STEAM_OPENID_URL)) {
    return Promise.resolve(
      new Response(`ns:${STEAM_OPENID_NS}\nis_valid:true\n`),
    );
  }
  if (url.includes('/ISteamUser/GetPlayerSummaries/')) {
    return Promise.resolve(Response.json({ response: { players: [] } }));
  }
  return realFetch(input, init);
}

const openIdCalls = () =>
  fetchSpy.mock.calls.filter((c: unknown[]) =>
    String(c[0]).startsWith(STEAM_OPENID_URL),
  ).length;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  token = await loginAsAdmin(testApp.request, testApp.seed);
  await testApp.app.get(SettingsService).setSteamApiKey('rok-1731-steam-key');
  fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(fakeSteam);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── helpers ──────────────────────────────────────────────────────────────────

type Res = { headers: Record<string, unknown>; status: number };

function cookie(res: Res, name: string): string {
  const raw = res.headers['set-cookie'];
  const lines = Array.isArray(raw) ? (raw as string[]) : [];
  const line = lines.find((l) => l.startsWith(`${name}=`));
  expect(line).toBeDefined();
  return (line as string).split(';')[0];
}

const location = (res: Res) => String(res.headers['location']);

function expectNoStore(res: Res) {
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
}

/** Run start + GET hop as the admin; returns what Steam would echo back. */
async function startFlow() {
  const start = await testApp.request
    .post('/auth/steam/link/start')
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(start.status).toBe(200);
  const hop = await testApp.request
    .get('/auth/steam/link')
    .query({ nonce: (start.body as { nonce: string }).nonce })
    .set('Cookie', cookie(start, 'rl_link_steam'));
  expect(hop.status).toBe(302);
  const issued = new URL(location(hop)).searchParams.get('openid.return_to');
  const state = new URL(issued as string).searchParams.get('state') as string;
  const stateCookie = cookie(hop, 'rl_link_state_steam');
  return { start, hop, issued: issued as string, state, stateCookie };
}

type Flow = Awaited<ReturnType<typeof startFlow>>;

/** Steam's shape: `<UTC second>Z<unique>`; unique so no test shares one. */
const freshNonce = () =>
  `${new Date().toISOString().slice(0, 19)}Z${randomUUID()}`;

function callback(flow: Flow, overrides: Record<string, string> = {}) {
  const query = {
    state: flow.state,
    'openid.ns': STEAM_OPENID_NS,
    'openid.mode': 'id_res',
    'openid.op_endpoint': STEAM_OPENID_URL,
    'openid.claimed_id': CLAIMED,
    'openid.identity': CLAIMED,
    'openid.return_to': flow.issued,
    'openid.response_nonce': freshNonce(),
    'openid.assoc_handle': '1234567890',
    'openid.signed': SIGNED,
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  };
  return testApp.request
    .get('/auth/steam/link/callback')
    .query(query)
    .set('Cookie', flow.stateCookie);
}

async function adminSteamId(): Promise<string | null> {
  const [row] = await testApp.db
    .select({ steamId: schema.users.steamId })
    .from(schema.users)
    .where(eq(schema.users.id, testApp.seed.adminUser.id));
  return row?.steamId ?? null;
}

// ── AC1d + AC2 — happy path ─────────────────────────────────────────────────

describe('Steam link callback — valid assertion (AC1d, AC2)', () => {
  it('links, contacts Steam once, and every hop is no-store', async () => {
    const flow = await startFlow();
    const res = await callback(flow);

    expect(res.status).toBe(302);
    expect(location(res)).toContain('?steam=success');
    expect(await adminSteamId()).toBe(STEAM_ID);
    expect(openIdCalls()).toBe(1);
    expectNoStore(res);
    expectNoStore(flow.hop);
    expect(flow.start.headers['cache-control']).toBe('no-store'); // OQ6
  });

  it('the expired GET hop 302 is no-store too', async () => {
    const res = await testApp.request
      .get('/auth/steam/link')
      .query({ nonce: 'not-a-real-nonce' });

    expect(res.status).toBe(302);
    expect(location(res)).toContain('/profile/integrations?steam=error');
    expectNoStore(res);
  });
});

// ── AC1b — locally invalid assertions never reach Steam ─────────────────────

describe('Steam link callback — invalid assertion (AC1b)', () => {
  it.each<[string, (f: Flow) => Record<string, string>]>([
    ['op_endpoint', () => ({ 'openid.op_endpoint': 'https://evil.test/op' })],
    [
      'return_to origin',
      (f) => ({
        'openid.return_to': f.issued.replace(
          new URL(f.issued).origin,
          'https://evil.test',
        ),
      }),
    ],
    [
      'signed list',
      () => ({ 'openid.signed': SIGNED.replace(',return_to', '') }),
    ],
  ])('rejects a bad %s without contacting Steam or linking', async (_l, o) => {
    const flow = await startFlow();
    const res = await callback(flow, o(flow));

    expect(res.status).toBe(302);
    expect(location(res)).toContain(FAILED);
    expect(openIdCalls()).toBe(0);
    expect(await adminSteamId()).toBeNull();
    expectNoStore(res);
  });
});

// ── AC1c — a replayed response_nonce is rejected by the store ───────────────

describe('Steam link callback — replayed response_nonce (AC1c)', () => {
  it('rejects the nonce in a second, independent flow', async () => {
    const nonce = freshNonce();
    const first = await callback(await startFlow(), {
      'openid.response_nonce': nonce,
    });
    expect(location(first)).toContain('?steam=success');
    // Unlink so the second flow would visibly link again if it got through.
    await testApp.db
      .update(schema.users)
      .set({ steamId: null })
      .where(eq(schema.users.id, testApp.seed.adminUser.id));

    const second = await callback(await startFlow(), {
      'openid.response_nonce': nonce,
    });

    expect(location(second)).toContain(FAILED);
    expect(openIdCalls()).toBe(1);
    expect(testApp.redisMock.store.has(steamNonceKey(nonce))).toBe(true);
    expect(await adminSteamId()).toBeNull();
  });
});
