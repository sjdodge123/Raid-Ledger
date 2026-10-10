/**
 * ROK-1727 — WowItemMetaService against the real `wow_item_meta` table:
 * enqueue writes rows (env 16 → env 4 fallback), getMeta reads them, the
 * upsert keeps one row per item, retryDue picks only due rows, and the kill
 * switch stops every write. Wowhead is never called: the fetch is stubbed by
 * spying on the `requireActual` module export the resolver calls through.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import { SettingsService } from '../../../settings/settings.service';
import { WowItemMetaService } from './wow-item-meta.service';
import type { WowheadEnv, WowheadFetchResult } from './wowhead-item.types';

const fetchModule = jest.requireActual<typeof import('./wowhead-item.fetch')>(
  './wowhead-item.fetch',
);

const HIT: WowheadFetchResult = {
  kind: 'found',
  name: 'Thunderfury',
  quality: 5,
  icon: 'inv_sword_39',
};

/** Item 19019 lives in env 16; 16921 only in env 4; 16922 nowhere. */
function stubWowhead(): jest.SpyInstance {
  return jest
    .spyOn(fetchModule, 'fetchWowheadItem')
    .mockImplementation((id: number, env: WowheadEnv) =>
      Promise.resolve(
        (id === 19019 && env === 16) || (id === 16921 && env === 4)
          ? HIT
          : { kind: 'not_found' },
      ),
    );
}

let testApp: TestApp;
let service: WowItemMetaService;

const rowOf = async (itemId: number) =>
  (
    await testApp.db
      .select()
      .from(schema.wowItemMeta)
      .where(eq(schema.wowItemMeta.itemId, itemId))
  )[0];

beforeAll(async () => {
  testApp = await getTestApp();
  service = testApp.app.get(WowItemMetaService);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await testApp.db.delete(schema.wowItemMeta);
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('WowItemMetaService on a real DB (ROK-1727)', () => {
  it('enqueue writes one row per item with the env fallback; getMeta reads them', async () => {
    const spy = stubWowhead();
    await expect(service.enqueue([19019, 16921, 16922, 19019])).resolves.toBe(
      3,
    );
    expect(await rowOf(19019)).toMatchObject({
      status: 'resolved',
      env: 16,
      name: 'Thunderfury',
      icon: 'inv_sword_39',
      quality: 5,
      attempts: 0,
    });
    expect(await rowOf(16921)).toMatchObject({
      status: 'classic_fallback',
      env: 4,
    });
    expect(await rowOf(16922)).toMatchObject({
      status: 'not_found',
      env: null,
      name: null,
    });
    const meta = await service.getMeta([19019, 16921, 16922, 1]);
    expect([...meta.keys()].sort()).toEqual([16921, 16922, 19019]);
    // 19019: one call; 16921 + 16922: env 16 then env 4.
    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('a second enqueue of fresh rows makes no call; retryDue re-probes only due rows and upgrades in place', async () => {
    await testApp.db.insert(schema.wowItemMeta).values([
      {
        itemId: 19019,
        status: 'classic_fallback',
        env: 4,
        name: 'Old',
        fetchedAt: new Date(),
        nextRetryAt: new Date(Date.now() - 60_000),
      },
      {
        itemId: 16921,
        status: 'classic_fallback',
        env: 4,
        name: 'Keep',
        fetchedAt: new Date(),
        nextRetryAt: new Date(Date.now() + 3_600_000),
      },
    ]);
    const spy = stubWowhead();
    await expect(service.enqueue([16921])).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
    await expect(service.retryDue()).resolves.toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await rowOf(19019)).toMatchObject({
      status: 'resolved',
      env: 16,
      name: 'Thunderfury',
    });
    expect(await rowOf(16921)).toMatchObject({ name: 'Keep' });
    const rows = await testApp.db.select().from(schema.wowItemMeta);
    expect(rows).toHaveLength(2);
  });

  it('a due resolved row is never downgraded by a classic_fallback or not_found re-probe', async () => {
    const due = new Date(Date.now() - 60_000);
    const forever = {
      status: 'resolved',
      env: 16,
      name: 'Forever',
      fetchedAt: due,
      nextRetryAt: due,
    };
    await testApp.db.insert(schema.wowItemMeta).values([
      { itemId: 16921, ...forever },
      { itemId: 16922, ...forever },
    ]);
    stubWowhead();
    await expect(service.retryDue()).resolves.toBe(2);
    for (const id of [16921, 16922]) {
      const row = await rowOf(id);
      expect(row).toMatchObject({
        status: 'resolved',
        env: 16,
        name: 'Forever',
      });
      expect(row?.nextRetryAt?.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('kill switch "false" → enqueue and retryDue write nothing and never fetch', async () => {
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.WOWHEAD_RESOLVER_ENABLED, 'false');
    const spy = stubWowhead();
    await expect(service.enqueue([19019])).resolves.toBe(0);
    await expect(service.retryDue()).resolves.toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(await testApp.db.select().from(schema.wowItemMeta)).toEqual([]);
  });
});
