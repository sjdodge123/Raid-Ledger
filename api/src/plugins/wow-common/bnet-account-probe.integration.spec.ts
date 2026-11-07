/**
 * ROK-2129 L2 — DEMO_MODE Battle.net account probe routes against a real DB:
 * AC6 (start gates + consent URL + binding cookie), AC8 (public callback with
 * no JWT: tampered state, missing cookie and a replayed nonce all 302
 * `code=state` with no Blizzard call), AC9 (callback closed without
 * DEMO_MODE), AC12 (GET state). Blizzard is stubbed via `global.fetch`.
 */
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { getClientUrl } from '../../settings/settings-bot.helpers';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

const ADMIN_ROUTE = '/admin/plugins/blizzard/bnet-account-probe';
const CALLBACK = '/plugins/blizzard/bnet-account-probe/callback';
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let adminToken: string;
let fetchSpy: jest.SpyInstance;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function memberToken(username: string): Promise<string> {
  const email = `${username}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username, role: 'member' })
      .returning(),
    'user',
  );
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash: await bcrypt.hash('TestPassword123!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

async function setDemoMode(on: boolean): Promise<void> {
  process.env.DEMO_MODE = on ? 'true' : 'false';
  await testApp.app.get(SettingsService).setDemoMode(on);
}

/** The `rl_bnet_probe_r=<value>` pair from a Set-Cookie header, or ''. */
function bindingCookie(setCookie: unknown): string {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  const hit = list.find(
    (c): c is string =>
      typeof c === 'string' && c.startsWith('rl_bnet_probe_r='),
  );
  return hit?.split(';')[0] ?? '';
}

/** POST /start as the admin → the minted state + binding cookie pair. */
async function start(): Promise<{ state: string; cookie: string }> {
  const res = await testApp.request
    .post(`${ADMIN_ROUTE}/start`)
    .set(auth(adminToken))
    .send({ region: 'us' });
  expect(res.status).toBe(200);
  const url = new URL(String(res.body.url));
  return {
    state: url.searchParams.get('state') ?? '',
    cookie: bindingCookie(res.headers['set-cookie']),
  };
}

async function returnBase(): Promise<string> {
  const client = await getClientUrl(testApp.app.get(SettingsService));
  return `${client}/admin/settings/integrations/plugin/blizzard/blizzard-api`;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { status: 404 }));
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await testApp.app
    .get(SettingsService)
    .setBlizzardConfig({ clientId: 'cid', clientSecret: 'secret' });
  await setDemoMode(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  fetchSpy.mockRestore();
  await testApp.app.get(SettingsService).setDemoMode(false);
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('POST /admin/plugins/blizzard/bnet-account-probe/start (AC6)', () => {
  it('admin gets the consent URL and the httpOnly binding cookie', async () => {
    const res = await testApp.request
      .post(`${ADMIN_ROUTE}/start`)
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(200);
    const url = new URL(String(res.body.url));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://oauth.battle.net/authorize',
    );
    const client = await getClientUrl(testApp.app.get(SettingsService));
    expect(url.searchParams.get('redirect_uri')).toBe(
      `${client}/api/plugins/blizzard/bnet-account-probe/callback`,
    );
    expect(url.searchParams.get('scope')).toBe('wow.profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const raw = JSON.stringify(res.headers['set-cookie']);
    expect(raw).toContain('rl_bnet_probe_r=');
    expect(raw).toContain('HttpOnly');
  });

  it('403 for a non-admin', async () => {
    const token = await memberToken('bnet_member');
    const res = await testApp.request
      .post(`${ADMIN_ROUTE}/start`)
      .set(auth(token))
      .send({});
    expect(res.status).toBe(403);
  });

  it('403 when the DEMO_MODE env is off', async () => {
    process.env.DEMO_MODE = 'false';
    const res = await testApp.request
      .post(`${ADMIN_ROUTE}/start`)
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it('403 when the DEMO_MODE DB flag is off', async () => {
    await testApp.app.get(SettingsService).setDemoMode(false);
    const res = await testApp.request
      .post(`${ADMIN_ROUTE}/start`)
      .set(auth(adminToken))
      .send({});
    expect(res.status).toBe(403);
  });

  it('400 for an unknown region', async () => {
    const res = await testApp.request
      .post(`${ADMIN_ROUTE}/start`)
      .set(auth(adminToken))
      .send({ region: 'kr' });
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/plugins/blizzard/bnet-account-probe (AC12)', () => {
  it('returns the callback redirectUri and a null result', async () => {
    const res = await testApp.request.get(ADMIN_ROUTE).set(auth(adminToken));
    const client = await getClientUrl(testApp.app.get(SettingsService));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      redirectUri: `${client}/api/plugins/blizzard/bnet-account-probe/callback`,
      result: null,
    });
  });
});

describe('GET /plugins/blizzard/bnet-account-probe/callback (AC8, AC9)', () => {
  it('tampered state → 302 code=state, no Blizzard call', async () => {
    const { state, cookie } = await start();
    const res = await testApp.request
      .get(CALLBACK)
      .query({ state: `${state}x`, code: 'c' })
      .set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${await returnBase()}?bnetProbe=error&code=state`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('missing binding cookie → 302 code=state', async () => {
    const { state } = await start();
    const res = await testApp.request.get(CALLBACK).query({ state, code: 'c' });
    expect(res.headers.location).toBe(
      `${await returnBase()}?bnetProbe=error&code=state`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a nonce consumed once (denied) cannot be replayed', async () => {
    const { state, cookie } = await start();
    const first = await testApp.request
      .get(CALLBACK)
      .query({ state, error: 'access_denied' })
      .set('Cookie', cookie);
    expect(first.headers.location).toBe(
      `${await returnBase()}?bnetProbe=error&code=denied`,
    );
    const replay = await testApp.request
      .get(CALLBACK)
      .query({ state, code: 'c' })
      .set('Cookie', cookie);
    expect(replay.headers.location).toBe(
      `${await returnBase()}?bnetProbe=error&code=state`,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const got = await testApp.request.get(ADMIN_ROUTE).set(auth(adminToken));
    expect(got.body.result).toMatchObject({ error: 'denied', token: null });
  });

  it('403 when DEMO_MODE is off (AC9)', async () => {
    const { state, cookie } = await start();
    process.env.DEMO_MODE = 'false';
    const res = await testApp.request
      .get(CALLBACK)
      .query({ state, code: 'c' })
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
