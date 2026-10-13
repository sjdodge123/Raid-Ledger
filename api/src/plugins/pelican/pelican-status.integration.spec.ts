/**
 * ROK-1772 — Pelican status poll, the member-facing provider feed
 * (`GET /game-servers/status`) and uninstall cleanup against a real database.
 * The panel is faked at the `PelicanClient` boundary (`fetchImpl`).
 */
import { eq } from 'drizzle-orm';
import { GameServerStatusResponseSchema } from '@raid-ledger/contract';
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
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import { PelicanStatusService } from './pelican-status.service';
import { fakeServer } from './testing/pelican-fixtures';
import {
  createFakePanel,
  memberToken,
  resourceUuids,
  stubPanel,
} from './testing/pelican-integration.helpers';

type ServerRow = typeof schema.pelicanServers.$inferSelect;
type ServerInsert = typeof schema.pelicanServers.$inferInsert;

const IP_PORT = '192.168.1.20:2456';
const MINUTE_MS = 60_000;

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const poll = () => testApp.app.get(PelicanStatusService).pollStatuses();

/** Insert server `n`: mapped to the seeded game, visible and present unless overridden. */
async function insertServer(
  n: number,
  overrides: Partial<ServerInsert> = {},
): Promise<ServerRow> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: testApp.seed.game.id,
        lastSyncedAt: new Date(),
        ...overrides,
      })
      .returning(),
    `pelican server ${n}`,
  );
  return row;
}

async function reload(id: number): Promise<ServerRow> {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.pelicanServers)
      .where(eq(schema.pelicanServers.id, id)),
    `pelican server id ${id}`,
  );
  return row;
}

/** Four rows: one pollable, plus one each of unmapped / hidden / missing. */
async function seedMixedRows() {
  const pollable = await insertServer(1);
  const unmapped = await insertServer(2, { gameId: null });
  const hidden = await insertServer(3, { showOnCalendar: false });
  const missing = await insertServer(4, { missingSince: new Date() });
  return { pollable, unmapped, hidden, missing };
}

function livePanelFor(rows: ServerRow[]) {
  const panel = createFakePanel([]);
  for (const r of rows) {
    panel.live.set(r.panelUuid, { state: 'running', suspended: false });
  }
  stubPanel(testApp, panel);
  return panel;
}

async function getStatus(token: string, query = '') {
  const res = await testApp.request
    .get(`/game-servers/status${query}`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const body = GameServerStatusResponseSchema.parse(res.body);
  const pelican = body.data.filter(
    (d) => d.provider === PELICAN_PROVIDER_LABEL,
  );
  return { res, pelican };
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

describe('PelicanStatusService.pollStatuses (ROK-1772)', () => {
  it('polls only mapped, visible, present servers and writes their state (D6)', async () => {
    const seeded = await seedMixedRows();
    const all = Object.values(seeded);
    const panel = livePanelFor(all);

    expect(await poll()).toEqual({ polled: 1, failed: 0, skipped: 0 });
    expect(resourceUuids(panel)).toEqual([seeded.pollable.panelUuid]);

    const polled = await reload(seeded.pollable.id);
    expect(polled.currentState).toBe('running');
    expect(polled.isSuspended).toBe(false);
    expect(polled.statusCheckedAt).toBeInstanceOf(Date);
    for (const skipped of [seeded.unmapped, seeded.hidden, seeded.missing]) {
      const row = await reload(skipped.id);
      expect(row.currentState).toBeNull();
      expect(row.statusCheckedAt).toBeNull();
    }
  });

  it('stores a suspended flag from the panel', async () => {
    const row = await insertServer(1);
    const panel = livePanelFor([]);
    panel.live.set(row.panelUuid, { state: 'offline', suspended: true });
    await poll();
    expect(await reload(row.id)).toMatchObject({
      currentState: 'offline',
      isSuspended: true,
    });
  });

  it('a 500 on one server keeps its previous state and check time; others update (D7)', async () => {
    const earlier = new Date(Date.now() - 10 * MINUTE_MS);
    const failing = await insertServer(1, {
      currentState: 'offline',
      statusCheckedAt: earlier,
    });
    const healthy = await insertServer(2);
    // Only `healthy` has live state; `failing` answers 500.
    livePanelFor([healthy]);

    expect(await poll()).toEqual({ polled: 1, failed: 1, skipped: 0 });
    const kept = await reload(failing.id);
    expect(kept.currentState).toBe('offline');
    expect(kept.statusCheckedAt?.getTime()).toBe(earlier.getTime());
    expect((await reload(healthy.id)).currentState).toBe('running');
  });

  it('skips a server checked in the last 20 seconds', async () => {
    const recent = await insertServer(1, {
      currentState: 'starting',
      statusCheckedAt: new Date(Date.now() - 5_000),
    });
    const panel = livePanelFor([recent]);
    expect(await poll()).toEqual({ polled: 0, failed: 0, skipped: 1 });
    expect(panel.fetchImpl).not.toHaveBeenCalled();
    expect((await reload(recent.id)).currentState).toBe('starting');
  });

  it('calls nothing and writes nothing while the plugin is inactive', async () => {
    const row = await insertServer(1);
    const panel = livePanelFor([row]);
    await registry().deactivate(PELICAN_PLUGIN_ID);
    expect(await poll()).toEqual({ polled: 0, failed: 0, skipped: 0 });
    expect(panel.fetchImpl).not.toHaveBeenCalled();
    expect((await reload(row.id)).statusCheckedAt).toBeNull();
  });
});

describe('GET /game-servers/status — Pelican provider (ROK-1772)', () => {
  it('returns member-safe names for mapped, visible, present servers only', async () => {
    const seeded = await seedMixedRows();
    const leaky = await insertServer(5, {
      name: `Valheim ${IP_PORT} ${fakeServer(5).uuid}`,
    });
    const suspended = await insertServer(6);
    const panel = livePanelFor([...Object.values(seeded), leaky]);
    panel.live.set(suspended.panelUuid, { state: 'running', suspended: true });
    await poll();

    const token = await memberToken(testApp, 'pelicanstatusmember');
    const { res, pelican } = await getStatus(token);

    const byKey = new Map(pelican.map((d) => [d.serverKey, d]));
    expect([...byKey.keys()].sort()).toEqual(
      [seeded.pollable.id, leaky.id, suspended.id].map(String).sort(),
    );
    const leakyDto = byKey.get(String(leaky.id));
    expect(leakyDto?.serverName).toContain('Valheim');
    expect(leakyDto?.gameId).toBe(testApp.seed.game.id);
    expect(leakyDto?.state).toBe('running');
    // Suspended reads Offline to members (ruling Q8).
    expect(byKey.get(String(suspended.id))?.state).toBe('offline');

    for (const dto of pelican) {
      expect(dto.serverName).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/);
      expect(dto.serverName).not.toMatch(/:\d{2,5}\b/);
    }
    const allRows = [...Object.values(seeded), leaky, suspended];
    for (const secret of [
      '192.168.1.20',
      ...allRows.flatMap((r) => [r.panelUuid, r.identifier]),
    ]) {
      expect(res.text).not.toContain(secret);
    }
  });

  it('filters by gameIds', async () => {
    const row = await insertServer(1);
    livePanelFor([row]);
    await poll();
    const token = await memberToken(testApp, 'pelicanfiltermember');
    const other = testApp.seed.game.id + 9_999;
    expect((await getStatus(token, `?gameIds=${other}`)).pelican).toEqual([]);
    const own = await getStatus(token, `?gameIds=${testApp.seed.game.id}`);
    expect(own.pelican.map((d) => d.serverKey)).toEqual([String(row.id)]);
  });

  it('omits mapped servers that were never checked', async () => {
    await insertServer(1);
    const token = await memberToken(testApp, 'pelicanneverchecked');
    expect((await getStatus(token)).pelican).toEqual([]);
  });

  it('returns nothing from Pelican while the plugin is inactive', async () => {
    const row = await insertServer(1);
    livePanelFor([row]);
    await poll();
    expect((await reload(row.id)).statusCheckedAt).toBeInstanceOf(Date);
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const token = await memberToken(testApp, 'pelicaninactivemember');
    expect((await getStatus(token)).pelican).toEqual([]);
  });
});

describe('Pelican uninstall — server rows (ROK-1772 D13)', () => {
  const pluginAction = (action: string) =>
    testApp.request
      .post(`/admin/plugins/${PELICAN_PLUGIN_ID}/${action}`)
      .set('Authorization', `Bearer ${adminToken}`);

  it('deletes pelican_servers and, by cascade, pelican_schedules', async () => {
    const server = await insertServer(1);
    await insertServer(2, { gameId: null });
    await testApp.db.insert(schema.pelicanSchedules).values({
      serverId: server.id,
      panelScheduleId: 1,
      name: 'Nightly restart',
      cronMinute: '0',
      cronHour: '4',
      cronDayOfMonth: '*',
      cronMonth: '*',
      cronDayOfWeek: '*',
      effect: 'restart',
    });

    expect((await pluginAction('deactivate')).status).toBe(200);
    expect((await pluginAction('uninstall')).status).toBe(200);

    // The uninstall listener is fire-and-forget; wait for the rows to go.
    await waitFor(async () => {
      expect(await testApp.db.select().from(schema.pelicanServers)).toEqual([]);
    });
    expect(await testApp.db.select().from(schema.pelicanSchedules)).toEqual([]);
  });
});
