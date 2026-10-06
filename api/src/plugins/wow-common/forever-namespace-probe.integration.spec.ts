/**
 * ROK-1716 — WoW: Forever namespace probe admin routes against a real DB:
 * `POST /admin/plugins/blizzard/forever-probe/run` persists the result,
 * `GET .../forever-probe` returns it, `PUT .../forever-probe/config` saves the
 * extra candidates (400 on bad input), all admin-only. Blizzard is stubbed via
 * `global.fetch` — no real network calls.
 */
import * as bcrypt from 'bcrypt';
import * as Sentry from '@sentry/nestjs';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';

jest.mock('@sentry/nestjs', () => ({
  ...jest.requireActual<object>('@sentry/nestjs'),
  captureMessage: jest.fn(),
}));

const ROUTE = '/admin/plugins/blizzard/forever-probe';
const SKYBORNE_URL =
  'us.api.blizzard.com/data/wow/playable-race/index?namespace=static-classicforever-us';

let testApp: TestApp;
let adminToken: string;
let fetchSpy: jest.SpyInstance;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** Blizzard stub: OAuth OK, Skyborne in classicforever-us's race index, else 404. */
function stubBlizzard(): void {
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.includes('battle.net/oauth/token')) {
        return Promise.resolve(json({ access_token: 't', expires_in: 3600 }));
      }
      if (url.includes(SKYBORNE_URL)) {
        return Promise.resolve(json({ races: [{ id: 99, name: 'Skyborne' }] }));
      }
      return Promise.resolve(json({}, 404));
    });
}

/** Sentry "found" alerts raised so far by the probe. */
function foundAlerts(): unknown[][] {
  return (Sentry.captureMessage as jest.Mock).mock.calls.filter(
    (c: unknown[]) => String(c[0]).startsWith('Forever namespace found'),
  );
}

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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  stubBlizzard();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await testApp.app
    .get(SettingsService)
    .setBlizzardConfig({ clientId: 'cid', clientSecret: 'secret' });
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  (Sentry.captureMessage as jest.Mock).mockClear();
});

afterEach(async () => {
  fetchSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('POST /admin/plugins/blizzard/forever-probe/run (ROK-1716)', () => {
  it('runs, persists the result, and GET returns it with found', async () => {
    const run = await testApp.request
      .post(`${ROUTE}/run`)
      .set(auth(adminToken));
    expect(run.status).toBe(200);
    expect(run.body.status).toBe('ok');
    expect(run.body.cells).toHaveLength(7 * 4 * 3);
    expect(run.body.matches).toEqual([
      { prefix: 'classicforever', region: 'us', raceName: 'Skyborne' },
    ]);
    expect(run.body.found).toMatchObject({ prefix: 'classicforever' });

    const got = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(got.status).toBe(200);
    expect(got.body.result).toEqual(run.body);
    expect(foundAlerts()).toHaveLength(1);
  });

  it('a second run with the same match raises no new found', async () => {
    const first = await testApp.request
      .post(`${ROUTE}/run`)
      .set(auth(adminToken));
    const second = await testApp.request
      .post(`${ROUTE}/run`)
      .set(auth(adminToken));
    expect(second.status).toBe(200);
    expect(second.body.found).toEqual(first.body.found);
    expect(foundAlerts()).toHaveLength(1);
  });
});

describe('PUT /admin/plugins/blizzard/forever-probe/config (ROK-1716)', () => {
  it('saves extra candidates that the next run probes', async () => {
    const put = await testApp.request
      .put(`${ROUTE}/config`)
      .set(auth(adminToken))
      .send({ extraCandidates: ['skyforever'], characterPath: null });
    expect(put.status).toBe(200);
    expect(put.body.extraCandidates).toEqual(['skyforever']);
    const run = await testApp.request
      .post(`${ROUTE}/run`)
      .set(auth(adminToken));
    expect(run.body.candidates).toContain('skyforever');
  });

  it('rejects a bad config with 400 and stores nothing', async () => {
    const res = await testApp.request
      .put(`${ROUTE}/config`)
      .set(auth(adminToken))
      .send({ extraCandidates: ['NOT A PREFIX!'], characterPath: null });
    expect(res.status).toBe(400);
    const got = await testApp.request.get(ROUTE).set(auth(adminToken));
    expect(got.body.extraCandidates).toEqual([]);
  });
});

describe('/admin/plugins/blizzard/forever-probe guards (ROK-1716)', () => {
  it('rejects a non-admin with 403 on GET, POST run and PUT config', async () => {
    const token = await memberToken('probeplayer');
    const get = await testApp.request.get(ROUTE).set(auth(token));
    const run = await testApp.request.post(`${ROUTE}/run`).set(auth(token));
    const put = await testApp.request
      .put(`${ROUTE}/config`)
      .set(auth(token))
      .send({ extraCandidates: [], characterPath: null });
    expect([get.status, run.status, put.status]).toEqual([403, 403, 403]);
    expect(foundAlerts()).toHaveLength(0);
  });
});
