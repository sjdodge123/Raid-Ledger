/**
 * ROK-2099 D6 / D7 / AC4 / AC6 — addon-error rows leave the store two ways,
 * against a real DB. Revoking a Companion device deletes that device's rows
 * at once, even with `blizzard` inactive (withdrawn-data cleanup is core).
 * The `blizzard` retention cron deletes rows last seen more than 90 days
 * ago, keeps newer ones, and does nothing while `blizzard` is inactive.
 * Rows are written by the production handler over HTTP, never inserted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  WOW_ADDON_ERRORS_CONTRACT_ID,
  WowAddonErrorsMessageSchema,
  type WowAddonErrorsMessage,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import * as schema from '../../../drizzle/schema';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
} from '../../../companion/devices/testing/companion-link.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { WowAddonErrorsRetentionCron } from './wow-addon-errors-retention.cron';

const MESSAGES = `/companion/v1/messages/${WOW_ADDON_ERRORS_CONTRACT_ID}`;
const BASE: WowAddonErrorsMessage = WowAddonErrorsMessageSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../../../../packages/contract/companion/wow-addon-errors/v1/fixtures/buggrabber-minimal.json',
      ),
      'utf8',
    ),
  ) as unknown,
);
const DAY_MS = 86_400_000;
const NOW = new Date('2026-11-19T05:45:00Z');

let testApp: TestApp;
const plugins = (): PluginRegistryService =>
  testApp.app.get(PluginRegistryService);
const cron = (): WowAddonErrorsRetentionCron =>
  testApp.app.get(WowAddonErrorsRetentionCron);
const t = schema.wowAddonErrorRecords;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  await plugins().ensureInstalled('blizzard');
  await plugins().activate('blizzard');
});

// No afterAll DB work: the shared integration-setup afterAll closes the pool.
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Upload one error per addon name from `token`'s device; expects 202. */
async function upload(token: string, addons: string[]): Promise<void> {
  const records = addons.map((addon) => ({
    addon,
    message: `Interface\\AddOns\\${addon}\\Core.lua:9: attempt to call a nil value`,
    firstSeenAt: '2026-10-30T08:00:00Z',
    lastSeenAt: '2026-10-30T09:00:00Z',
    count: 1,
  }));
  const res = await testApp.request
    .post(MESSAGES)
    .set(bearer(token))
    .send({
      ...BASE,
      capturedAt: '2026-11-01T00:00:00Z',
      payload: { ...BASE.payload, records },
    });
  expect({ status: res.status, body: res.body }).toEqual({
    status: 202,
    body: { status: 'accepted' },
  });
}

/** Every row as `addon` → `{ userId, deviceId }`, sorted by addon. */
const stored = async () =>
  (await testApp.db.select().from(t))
    .map((r) => ({ addon: r.addon, userId: r.userId, deviceId: r.deviceId }))
    .sort((a, b) => a.addon.localeCompare(b.addon));

/** Stamp `last_seen_at` of the row for `addon` to `days` before NOW. */
async function lastSeenDaysAgo(addon: string, days: number): Promise<void> {
  await testApp.db
    .update(t)
    .set({ lastSeenAt: new Date(NOW.getTime() - days * DAY_MS) })
    .where(eq(t.addon, addon));
}

describe('revoke cleanup (D6, AC4)', () => {
  it('revoking a device with blizzard inactive deletes only that device’s rows', async () => {
    const a = await makeUser(testApp, 'ae-revoke-a');
    const b = await makeUser(testApp, 'ae-revoke-b');
    const a1 = await linkDevice(testApp, a.token);
    const a2 = await linkDevice(testApp, a.token);
    const b1 = await linkDevice(testApp, b.token);
    await upload(a1.token, ['AlphaOne', 'AlphaTwo']);
    await upload(a2.token, ['AlphaOther']);
    await upload(b1.token, ['BravoOne']);
    await plugins().deactivate('blizzard');
    try {
      const del = await testApp.request
        .delete(`/companion/v1/devices/${a1.deviceId}`)
        .set(bearer(a.token));
      expect(del.status).toBe(204);
      expect(await stored()).toEqual([
        { addon: 'AlphaOther', userId: a.id, deviceId: a2.deviceId },
        { addon: 'BravoOne', userId: b.id, deviceId: b1.deviceId },
      ]);
    } finally {
      await plugins().activate('blizzard');
    }
  });

  it('a refused revoke (another user’s device) deletes nothing', async () => {
    const a = await makeUser(testApp, 'ae-revoke-own');
    const b = await makeUser(testApp, 'ae-revoke-foreign');
    const a1 = await linkDevice(testApp, a.token);
    await upload(a1.token, ['AlphaKept']);
    const del = await testApp.request
      .delete(`/companion/v1/devices/${a1.deviceId}`)
      .set(bearer(b.token));
    expect(del.status).toBe(404);
    expect(await stored()).toEqual([
      { addon: 'AlphaKept', userId: a.id, deviceId: a1.deviceId },
    ]);
  });
});

describe('retention cron (D7, AC6)', () => {
  it('deletes rows last seen more than 90 days ago and keeps the rest', async () => {
    const a = await makeUser(testApp, 'ae-retention');
    const dev = await linkDevice(testApp, a.token);
    await upload(dev.token, ['Ancient', 'JustOver', 'JustUnder', 'Fresh']);
    await lastSeenDaysAgo('Ancient', 400);
    await lastSeenDaysAgo('JustOver', 90.01);
    await lastSeenDaysAgo('JustUnder', 89.99);
    await lastSeenDaysAgo('Fresh', 1);
    await expect(cron().runOnce(NOW)).resolves.toBe(2);
    expect((await stored()).map((r) => r.addon)).toEqual([
      'Fresh',
      'JustUnder',
    ]);
  });

  it('the scheduled tick deletes nothing while blizzard is inactive, then prunes once active', async () => {
    const a = await makeUser(testApp, 'ae-retention-off');
    const dev = await linkDevice(testApp, a.token);
    await upload(dev.token, ['Ancient']);
    await lastSeenDaysAgo('Ancient', 400);
    await plugins().deactivate('blizzard');
    try {
      await cron().prune();
      expect((await stored()).map((r) => r.addon)).toEqual(['Ancient']);
    } finally {
      await plugins().activate('blizzard');
    }
    await cron().prune();
    expect(await stored()).toEqual([]);
  });
});
