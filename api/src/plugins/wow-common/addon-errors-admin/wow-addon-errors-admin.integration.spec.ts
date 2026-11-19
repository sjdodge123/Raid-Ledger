/**
 * ROK-2099 S3 / AC3 — admin reads of uploaded addon errors against a real DB:
 * groups by (addon, message) with members / characters / counts, every
 * filter, pagination, the detail route, JSON + CSV export, 403 for a
 * non-admin on every route and for everyone while `blizzard` is inactive.
 * Data comes from the DEMO_MODE seed endpoint (S4 uses the same one).
 */
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import {
  ADDON_ERRORS_ADMIN_PAGE_SIZE,
  AddonErrorExportRowSchema,
  type AddonErrorGroupDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { addonErrorRow } from '../../../admin/demo-test-addon-errors.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';

const BASE = '/admin/plugins/blizzard/addon-errors';
const SEED = '/admin/test/wow/seed-addon-errors';
const HOUR_MS = 3_600_000;
const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

let testApp: TestApp;
let adminToken: string;
let userIds: number[];

const get = (path: string, token = adminToken) =>
  testApp.request.get(path).set('Authorization', `Bearer ${token}`);
const list = async (
  qs = '',
): Promise<{
  items: AddonErrorGroupDto[];
  total: number;
  page: number;
  pageSize: number;
}> => {
  const res = await get(`${BASE}${qs}`);
  expect(res.status).toBe(200);
  return res.body as {
    items: AddonErrorGroupDto[];
    total: number;
    page: number;
    pageSize: number;
  };
};
const addons = (items: AddonErrorGroupDto[]) => items.map((g) => g.addon);

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

beforeAll(async () => {
  testApp = await getTestApp();
  process.env.DEMO_MODE = 'true';
});

beforeEach(async () => {
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  await testApp.app.get(SettingsService).setDemoMode(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  const seeded = await testApp.request
    .post(SEED)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(seeded.status).toBe(200);
  expect(seeded.body.inserted).toBe(4);
  userIds = seeded.body.userIds as number[];
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('GET /admin/plugins/blizzard/addon-errors — grouping (ROK-2099 S3)', () => {
  it('groups by (addon, message) with members, characters, counts and the newest stack', async () => {
    const page = await list();
    expect(page).toMatchObject({
      total: 3,
      page: 1,
      pageSize: ADDON_ERRORS_ADMIN_PAGE_SIZE,
    });
    expect(addons(page.items)).toEqual(['DBM-Core', 'Questie', 'Details']);
    const questie = page.items.find((g) => g.addon === 'Questie');
    expect(questie).toMatchObject({
      totalCount: 17,
      members: [
        { userId: userIds[0], username: 'addon-err-aldric' },
        { userId: userIds[1], username: 'addon-err-brannoc' },
      ],
      characters: [
        { name: 'Aldric', realm: 'Demo Realm' },
        { name: 'Brannoc', realm: 'Demo Realm' },
      ],
    });
    expect(questie?.sampleStack).toContain(':812:');
    const sig = createHash('sha256')
      .update(`${questie?.addon}\n${questie?.message}`, 'utf8')
      .digest('hex');
    expect(questie?.signature).toBe(sig);
  });

  it('seeding twice replaces the demo records instead of adding to them', async () => {
    const again = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(again.body).toEqual({ userIds, inserted: 4 });
    expect((await list()).total).toBe(3);
  });
});

describe('filters (ROK-2099 S3)', () => {
  it('addon is an exact match', async () => {
    expect(addons((await list('?addon=Questie')).items)).toEqual(['Questie']);
    expect((await list('?addon=quest')).total).toBe(0);
  });

  it('userId keeps only that uploader’s records inside each group', async () => {
    const page = await list(`?userId=${userIds[1]}`);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      addon: 'Questie',
      totalCount: 3,
      members: [{ username: 'addon-err-brannoc' }],
    });
  });

  it('since drops records last seen before it', async () => {
    const since = new Date(Date.now() - 2 * HOUR_MS).toISOString();
    const page = await list(`?since=${encodeURIComponent(since)}`);
    expect(addons(page.items)).toEqual(['DBM-Core', 'Questie']);
    expect(page.items.find((g) => g.addon === 'Questie')?.totalCount).toBe(14);
  });

  it('q matches addon or message case-insensitively, LIKE wildcards escaped', async () => {
    expect(addons((await list('?q=INDEX%20field')).items)).toEqual(['Questie']);
    expect(addons((await list('?q=details')).items)).toEqual(['Details']);
    expect((await list('?q=%25')).total).toBe(0);
  });

  it('a malformed filter is a 400', async () => {
    expect((await get(`${BASE}?since=yesterday`)).status).toBe(400);
    expect((await get(`${BASE}?page=0`)).status).toBe(400);
  });
});

describe('pagination (ROK-2099 S3)', () => {
  it('pages 25 groups at a time, newest first, with the total on every page', async () => {
    const old = new Date(Date.now() - 100 * HOUR_MS);
    const extra = Array.from({ length: 26 }, (_, i) =>
      addonErrorRow(
        userIds[0] ?? 0,
        {
          addon: 'Bulk',
          message: `bulk error ${String(i).padStart(2, '0')}`,
          lastSeenAt: old,
          firstSeenAt: old,
        },
        new Date(),
      ),
    );
    await testApp.db.insert(schema.wowAddonErrorRecords).values(extra);
    const one = await list('?page=1');
    const two = await list('?page=2');
    expect([one.total, one.items.length, two.total, two.items.length]).toEqual([
      29, 25, 29, 4,
    ]);
    expect(addons(one.items).slice(0, 3)).toEqual([
      'DBM-Core',
      'Questie',
      'Details',
    ]);
    expect(two.items.map((g) => g.message)).toEqual([
      'bulk error 22',
      'bulk error 23',
      'bulk error 24',
      'bulk error 25',
    ]);
    expect(await list('?page=3')).toMatchObject({ total: 29, items: [] });
  });
});

describe('GET :signature (ROK-2099 S3)', () => {
  it('returns every member/character occurrence with the full stack, newest first', async () => {
    const questie = (await list('?addon=Questie')).items[0];
    const res = await get(`${BASE}/${questie?.signature}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      signature: questie?.signature,
      addon: 'Questie',
      message: questie?.message,
    });
    expect(res.body.occurrences).toMatchObject([
      {
        member: { userId: userIds[0] },
        characterName: 'Aldric',
        characterRealm: 'Demo Realm',
        count: 14,
        source: 'buggrabber',
      },
      { member: { userId: userIds[1] }, characterName: 'Brannoc', count: 3 },
    ]);
    expect(res.body.occurrences[1].stack).toContain(':813:');
  });

  it('404 for an unknown signature, 400 for a malformed one', async () => {
    expect((await get(`${BASE}/${'f'.repeat(64)}`)).status).toBe(404);
    expect((await get(`${BASE}/not-a-hash`)).status).toBe(400);
  });
});

describe('GET export (ROK-2099 S3)', () => {
  it('json: the stored scrubbed rows (no account key / device), filtered, as a download', async () => {
    const res = await get(`${BASE}/export?format=json&addon=Questie`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="addon-errors-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(res.body.rows).toHaveLength(2);
    for (const row of res.body.rows as unknown[]) {
      expect(Object.keys(row as object).sort()).toEqual(
        Object.keys(AddonErrorExportRowSchema.shape).sort(),
      );
      expect(AddonErrorExportRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it('csv: header + one escaped line per row', async () => {
    const res = await get(`${BASE}/export?format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/\.csv"$/);
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'id,userId,username,characterName,characterRealm,source,sourceVersion,addon,message,stack,count,session,firstSeenAt,lastSeenAt,recordHash,scrubbedCount',
    );
    expect(lines).toHaveLength(6); // header + 4 rows + trailing ''
    expect(res.text).toContain(
      '"Details\\core\\parser.lua:44: ""spell, id"" is not a number"',
    );
  });

  it('defaults to json and 400s an unknown format', async () => {
    expect((await get(`${BASE}/export`)).body.rows).toHaveLength(4);
    expect((await get(`${BASE}/export?format=xml`)).status).toBe(400);
  });
});

describe('access (ROK-2099 S3)', () => {
  const routes = () => [
    BASE,
    `${BASE}/${'f'.repeat(64)}`,
    `${BASE}/export?format=csv`,
  ];

  it('a non-admin gets 403 on every read route and on the seed endpoint', async () => {
    const token = await memberToken('addon-err-member');
    for (const path of routes()) {
      expect([path, (await get(path, token)).status]).toEqual([path, 403]);
    }
    const seed = await testApp.request
      .post(SEED)
      .set('Authorization', `Bearer ${token}`);
    expect(seed.status).toBe(403);
  });

  it('while blizzard is inactive even an admin gets 403 on every route', async () => {
    await testApp.app.get(PluginRegistryService).deactivate('blizzard');
    for (const path of routes()) {
      expect([path, (await get(path)).status]).toEqual([path, 403]);
    }
  });

  it('no token is a 401', async () => {
    expect((await testApp.request.get(BASE)).status).toBe(401);
  });
});
