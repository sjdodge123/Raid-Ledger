/**
 * ROK-1772 — Pelican server sync against a real database, panel faked at the
 * `PelicanClient` boundary (`fetchImpl`). Covers the upsert, missing-mark and
 * restore arithmetic, the all-or-nothing listing rule (D3), admin mapping
 * surviving a re-sync (D4), the single-flight guard (D10) and
 * `POST /admin/plugins/pelican/sync`.
 */
import { Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { PelicanSyncResultSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanSyncService } from './pelican-sync.service';
import { fakeServer } from './testing/pelican-fixtures';
import {
  FAKE_CLIENT_KEY,
  createFakePanel,
  deferredGate,
  listingCalls,
  memberToken,
  stubPanel,
} from './testing/pelican-integration.helpers';

const SYNC_ROUTE = '/admin/plugins/pelican/sync';
const S1 = fakeServer(1);
const S2 = fakeServer(2);
const S3 = fakeServer(3);

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const syncService = () => testApp.app.get(PelicanSyncService);

const postSync = (token = adminToken) =>
  testApp.request.post(SYNC_ROUTE).set('Authorization', `Bearer ${token}`);

async function rows(): Promise<(typeof schema.pelicanServers.$inferSelect)[]> {
  return testApp.db
    .select()
    .from(schema.pelicanServers)
    .orderBy(asc(schema.pelicanServers.panelUuid));
}

async function rowFor(uuid: string) {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.pelicanServers)
      .where(eq(schema.pelicanServers.panelUuid, uuid)),
    `pelican_servers row ${uuid}`,
  );
  return row;
}

/** Run one sync that must succeed. */
async function syncOk() {
  const outcome = await syncService().syncServers();
  expect(outcome.code).toBe('ok');
  return outcome;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('PelicanSyncService.syncServers — upsert and missing (ROK-1772)', () => {
  it('upserts every listed server on the first sync', async () => {
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    const outcome = await syncOk();
    expect(outcome).toEqual({
      code: 'ok',
      upserted: 2,
      markedMissing: 0,
      restored: 0,
    });
    const stored = await rows();
    expect(stored.map((r) => [r.panelUuid, r.identifier, r.name])).toEqual([
      [S1.uuid, S1.identifier, S1.name],
      [S2.uuid, S2.identifier, S2.name],
    ]);
    for (const r of stored) {
      expect(r.missingSince).toBeNull();
      expect(r.lastSyncedAt).toBeInstanceOf(Date);
      expect(r.gameId).toBeNull();
      expect(r.showOnCalendar).toBe(true);
    }
  });

  it('marks an absent server missing, then restores it when it returns', async () => {
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    await syncOk();

    panel.servers = [S1];
    expect(await syncOk()).toEqual({
      code: 'ok',
      upserted: 1,
      markedMissing: 1,
      restored: 0,
    });
    const missing = await rowFor(S2.uuid);
    expect(missing.missingSince).toBeInstanceOf(Date);
    expect((await rowFor(S1.uuid)).missingSince).toBeNull();

    // A second absent sync keeps the FIRST missing timestamp (D5).
    const firstMissing = missing.missingSince;
    expect((await syncOk()).markedMissing).toBe(0);
    expect((await rowFor(S2.uuid)).missingSince).toEqual(firstMissing);

    panel.servers = [S1, S2];
    expect(await syncOk()).toEqual({
      code: 'ok',
      upserted: 2,
      markedMissing: 0,
      restored: 1,
    });
    expect((await rowFor(S2.uuid)).missingSince).toBeNull();
  });

  it('a subuser listing that shows 1 of 2 known servers marks the other missing without error', async () => {
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    await syncOk();

    panel.servers = [S2];
    const outcome = await syncOk();
    expect(outcome.markedMissing).toBe(1);
    expect((await rowFor(S1.uuid)).missingSince).toBeInstanceOf(Date);
    expect((await rowFor(S2.uuid)).missingSince).toBeNull();
  });

  it('a failed page writes nothing and marks nothing missing (D3)', async () => {
    const panel = createFakePanel([S1, S2, S3]);
    stubPanel(testApp, panel);
    await syncOk();
    const before = await rows();

    // Page 1 now lists only S1 (page size 1); page 2 fails.
    panel.pageSize = 1;
    panel.failPage = 2;
    panel.servers = [
      { ...S1, name: 'Renamed While Failing' },
      S2,
    ];
    const outcome = await syncService().syncServers();
    expect(outcome.code).not.toBe('ok');
    expect(outcome).toMatchObject({
      upserted: 0,
      markedMissing: 0,
      restored: 0,
    });
    // 1 call for the first sync, then pages 1 and 2 (the failure).
    expect(listingCalls(panel)).toBeGreaterThanOrEqual(3);
    expect(await rows()).toEqual(before);
  });
});

describe('PelicanSyncService.syncServers — admin mapping survives (ROK-1772 D4)', () => {
  it('keeps game_id, show_on_calendar and timezone across a re-sync and a missing/restore cycle', async () => {
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    await syncOk();
    const gameId = testApp.seed.game.id;
    await testApp.db
      .update(schema.pelicanServers)
      .set({ gameId, showOnCalendar: false, timezone: 'Europe/Berlin' })
      .where(eq(schema.pelicanServers.panelUuid, S1.uuid));

    panel.servers = [{ ...S1, name: 'Renamed On Panel' }, S2];
    await syncOk();
    const renamed = await rowFor(S1.uuid);
    expect(renamed.name).toBe('Renamed On Panel');
    expect(renamed).toMatchObject({
      gameId,
      showOnCalendar: false,
      timezone: 'Europe/Berlin',
    });

    panel.servers = [S2];
    await syncOk();
    panel.servers = [S1, S2];
    await syncOk();
    expect(await rowFor(S1.uuid)).toMatchObject({
      gameId,
      showOnCalendar: false,
      timezone: 'Europe/Berlin',
      missingSince: null,
    });
  });
});

describe('PelicanSyncService.syncServers — guards (ROK-1772)', () => {
  it('returns not_configured and calls nothing when no panel is saved', async () => {
    const outcome = await syncService().syncServers();
    expect(outcome).toEqual({
      code: 'not_configured',
      upserted: 0,
      markedMissing: 0,
      restored: 0,
    });
    expect(await rows()).toEqual([]);
  });

  it('returns not_configured without calling the panel while the plugin is inactive', async () => {
    const panel = createFakePanel([S1]);
    stubPanel(testApp, panel);
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const outcome = await syncService().syncServers();
    expect(outcome.code).toBe('not_configured');
    expect(panel.fetchImpl).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it('answers in_progress to an overlapping run and lists the panel once (D10)', async () => {
    const panel = createFakePanel([S1]);
    const { gate, release } = deferredGate();
    panel.gate = gate;
    stubPanel(testApp, panel);

    const first = syncService().syncServers();
    await waitFor(async () => {
      expect(panel.fetchImpl).toHaveBeenCalledTimes(1);
    });
    const second = await syncService().syncServers();
    expect(second.code).toBe('in_progress');

    release();
    expect((await first).code).toBe('ok');
    expect(listingCalls(panel)).toBe(1);
    expect(await rows()).toHaveLength(1);
  });
});

describe('POST /admin/plugins/pelican/sync (ROK-1772)', () => {
  function captureLogs(): () => string {
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
      (level) => jest.spyOn(Logger.prototype, level),
    );
    return () =>
      spies.map((s) => JSON.stringify(s.mock.calls)).join('\n');
  }

  it('syncs for an admin and returns a schema-valid body with no key or uuid', async () => {
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    const logs = captureLogs();

    const res = await postSync();
    expect(res.status).toBe(200);
    const body = PelicanSyncResultSchema.parse(res.body);
    expect(body).toMatchObject({
      code: 'ok',
      upserted: 2,
      markedMissing: 0,
      restored: 0,
      // New rows are unmapped, so the follow-up poll has nothing to check.
      status: { polled: 0, failed: 0, skipped: 0 },
    });
    expect(await rows()).toHaveLength(2);

    const output = `${res.text}\n${logs()}`;
    for (const secret of [
      FAKE_CLIENT_KEY,
      S1.uuid,
      S2.uuid,
      S1.identifier,
      S1.name,
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it('answers not_configured with a null status when no panel is saved', async () => {
    const res = await postSync();
    expect(res.status).toBe(200);
    const body = PelicanSyncResultSchema.parse(res.body);
    expect(body).toMatchObject({
      code: 'not_configured',
      upserted: 0,
      markedMissing: 0,
      restored: 0,
      status: null,
    });
  });

  it('rejects a non-admin member with 403 and syncs nothing', async () => {
    const panel = createFakePanel([S1]);
    stubPanel(testApp, panel);
    const token = await memberToken(testApp, 'pelicansyncmember');
    expect((await postSync(token)).status).toBe(403);
    expect(panel.fetchImpl).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it('rejects with 403 while the plugin is inactive', async () => {
    const panel = createFakePanel([S1]);
    stubPanel(testApp, panel);
    await registry().deactivate(PELICAN_PLUGIN_ID);
    expect((await postSync()).status).toBe(403);
    expect(panel.fetchImpl).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });

  it('rejects an unauthenticated request with 401', async () => {
    expect((await testApp.request.post(SYNC_ROUTE)).status).toBe(401);
  });
});
