/**
 * ROK-2361 #9 — the Blizzard API settings routes belong to the `blizzard`
 * plugin: reading, saving and testing the keys refuse with 403 while it is
 * off and work while it is on. Clearing the keys (the admin withdrawing data)
 * runs regardless.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';

const SLUG = 'blizzard';
const REFUSAL = `Plugin "${SLUG}" is not active`;

let testApp: TestApp;
let registry: PluginRegistryService;
let adminToken: string;

async function setActive(active: boolean): Promise<void> {
  await registry.ensureInstalled(SLUG);
  await registry.activate(SLUG);
  if (!active) await registry.deactivate(SLUG);
}

function getStatus() {
  return testApp.request
    .get('/admin/settings/blizzard')
    .set('Authorization', `Bearer ${adminToken}`);
}

function putKeys() {
  return testApp.request
    .put('/admin/settings/blizzard')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ clientId: 'rok-2361-id', clientSecret: 'rok-2361-secret' });
}

function postTest() {
  return testApp.request
    .post('/admin/settings/blizzard/test')
    .set('Authorization', `Bearer ${adminToken}`);
}

function postClear() {
  return testApp.request
    .post('/admin/settings/blizzard/clear')
    .set('Authorization', `Bearer ${adminToken}`);
}

beforeAll(async () => {
  testApp = await getTestApp();
  registry = testApp.app.get(PluginRegistryService);
});

beforeEach(async () => {
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  await setActive(true);
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('Blizzard settings routes with the blizzard plugin OFF (ROK-2361 #9)', () => {
  beforeEach(() => setActive(false));

  it.each([
    ['GET /admin/settings/blizzard', getStatus],
    ['PUT /admin/settings/blizzard', putKeys],
    ['POST /admin/settings/blizzard/test', postTest],
  ])('%s refuses with 403 "%s"', async (_label, send) => {
    const res = await send();
    expect({ status: res.status, message: res.body?.message }).toEqual({
      status: 403,
      message: REFUSAL,
    });
  });

  it('a refused PUT stores nothing', async () => {
    await putKeys();
    await setActive(true);
    expect((await getStatus()).body).toEqual({ configured: false });
  });

  it('POST /admin/settings/blizzard/clear still clears the keys', async () => {
    await setActive(true);
    expect((await putKeys()).status).toBe(200);
    await setActive(false);
    const res = await postClear();
    expect(res.status).toBe(200);
    await setActive(true);
    expect((await getStatus()).body).toEqual({ configured: false });
  });
});

describe('Blizzard settings routes with the blizzard plugin ON (ROK-2361 #9)', () => {
  beforeEach(() => setActive(true));

  it('GET reports the keys unset, then set after a PUT', async () => {
    const before = await getStatus();
    expect({ status: before.status, body: before.body }).toEqual({
      status: 200,
      body: { configured: false },
    });
    expect((await putKeys()).status).toBe(200);
    expect((await getStatus()).body).toEqual({ configured: true });
  });

  it('POST test answers without calling Blizzard when no keys are set', async () => {
    const res = await postTest();
    expect({ status: res.status, body: res.body }).toEqual({
      status: 200,
      body: { success: false, message: 'Blizzard API is not configured' },
    });
  });
});
