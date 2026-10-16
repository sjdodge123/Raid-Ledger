/**
 * ROK-1094 — POST /admin/test/pelican/seed-servers (integration, real DB).
 * The DEMO_MODE fixture the fleet UI test plan seeds before each run: four
 * admin-table rows, a fake unreachable connection, and reset on re-run.
 * ROK-1096: the running+mapped row also gets a start/stop window + nightly
 * restart, and the offline row a nightly restart (all crons UTC, ROK-1795).
 * (403 without DEMO_MODE is the shared DemoModeGuard's own spec.)
 */
import { eq } from 'drizzle-orm';
import {
  GameServerCalendarResponseSchema,
  PelicanServerListResponseSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import {
  DEMO_BACKUP_OFFSET_S,
  DEMO_RESTART_OFFSET_S,
} from './pelican-demo-seed-schedules.helpers';
import {
  DEMO_PELICAN_API_KEY,
  DEMO_PELICAN_PANEL_URL,
  type PelicanSeedResult,
} from './pelican-demo-seed.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/pelican/seed-servers';

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);

async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

async function seed(): Promise<PelicanSeedResult> {
  const res = await testApp.request
    .post(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  expect(res.text).not.toContain(DEMO_PELICAN_API_KEY);
  return res.body as PelicanSeedResult;
}

async function adminGet(path: string) {
  const res = await testApp.request
    .get(path)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  return res;
}

/** The admin table as the web panel sees it, keyed by row id. */
async function adminRows() {
  const res = await adminGet('/admin/plugins/pelican/servers');
  const body = PelicanServerListResponseSchema.parse(res.body);
  return new Map(body.data.map((r) => [r.id, r]));
}

/** Pelican items over the next 3 days, as `window:<label>` / `marker:<effect>`; all must be `serverId`'s. */
async function pelicanCalendarKinds(serverId: number): Promise<string[]> {
  const from = new Date();
  const to = new Date(from.getTime() + 3 * 86_400_000);
  const q = `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const cal = await adminGet(`/game-servers/calendar?${q}`);
  const items = GameServerCalendarResponseSchema.parse(cal.body).data.filter(
    (i) => i.provider === PELICAN_PROVIDER_LABEL,
  );
  expect(new Set(items.map((i) => i.serverKey))).toEqual(
    new Set([String(serverId)]),
  );
  return items.map((i) =>
    i.kind === 'window' ? `window:${i.label}` : `marker:${i.effect}`,
  );
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterEach(async () => {
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/pelican/seed-servers (ROK-1094)', () => {
  it('activates Pelican with a fake connection and seeds the four table states', async () => {
    const seeded = await seed();
    expect(registry().isActive(PELICAN_PLUGIN_ID)).toBe(true);
    const config = await adminGet('/admin/plugins/pelican/config');
    expect(config.body).toMatchObject({
      panelUrl: DEMO_PELICAN_PANEL_URL,
      apiKeySet: true,
    });
    expect(config.text).not.toContain(DEMO_PELICAN_API_KEY);

    expect(seeded.gameId).toBeGreaterThan(0);
    expect(seeded.servers.map((s) => s.kind)).toEqual([
      'running_mapped',
      'offline_unmapped',
      'unknown_hidden',
      'missing',
    ]);
    const rows = await adminRows();
    const view = seeded.servers.map((s) => {
      const r = rows.get(s.id);
      if (!r) throw new Error(`seeded row ${s.id} missing from GET servers`);
      return [s.kind, r.state, r.gameId, r.showOnCalendar, r.missing];
    });
    expect(view).toEqual([
      ['running_mapped', 'running', seeded.gameId, true, false],
      ['offline_unmapped', 'offline', null, true, false],
      ['unknown_hidden', 'unknown', seeded.gameId, false, false],
      ['missing', 'unknown', null, true, true],
    ]);
    expect(rows.size).toBe(4);
  });

  it('is idempotent: a re-run wipes edits and leaves exactly four fresh rows', async () => {
    const first = await seed();
    const unmapped = first.servers.find((s) => s.kind === 'offline_unmapped');
    if (!unmapped) throw new Error('first seed: no offline_unmapped row');
    const edit = await testApp.request
      .patch(`/admin/plugins/pelican/servers/${unmapped.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: first.gameId });
    expect(edit.status).toBe(200);

    const second = await seed();
    const stored = await testApp.db.select().from(schema.pelicanServers);
    expect(stored).toHaveLength(4);
    expect(stored.map((r) => r.id).sort()).toEqual(
      second.servers.map((s) => s.id).sort(),
    );
    const firstIds = new Set(first.servers.map((s) => s.id));
    expect(second.servers.filter((s) => firstIds.has(s.id))).toEqual([]);
    const reset = second.servers.find((s) => s.kind === 'offline_unmapped');
    expect(stored.find((r) => r.id === reset?.id)?.gameId).toBeNull();
    expect(second.gameId).toBe(first.gameId);
  });
});

describe('POST /admin/test/pelican/seed-servers — schedules (ROK-1096)', () => {
  it('seeds calendar schedules: a window + restart markers on the running row, all UTC (ROK-1096, ROK-1795)', async () => {
    const seeded = await seed();
    const byKind = new Map(seeded.servers.map((s) => [s.kind, s]));
    const running = byKind.get('running_mapped');
    const offline = byKind.get('offline_unmapped');
    if (!running || !offline) throw new Error('seed: kinds missing');

    expect(seeded.servers.map((s) => [s.kind, s.scheduleCount])).toEqual([
      ['running_mapped', 6],
      ['offline_unmapped', 1],
      ['unknown_hidden', 0],
      ['missing', 0],
    ]);
    const stored = await testApp.db.select().from(schema.pelicanSchedules);
    expect(
      stored
        .filter((r) => r.serverId === running.id)
        .map((r) => [r.effect, r.effectOffsetS, r.nextRunAt])
        .sort(),
    ).toEqual([
      ['backup', DEMO_BACKUP_OFFSET_S, null],
      ['restart', DEMO_RESTART_OFFSET_S, null],
      ['start', 0, null],
      ['start', 0, null],
      ['stop', 0, null],
      ['stop', 0, null],
    ]);

    const kinds = await pelicanCalendarKinds(running.id);
    expect(kinds).toContain('window:Evening open');
    expect(kinds).toContain('marker:restart');
    // ROK-1774: a backup coincident with the restart, and a short window.
    expect(kinds).toContain('marker:backup');
    expect(kinds).toContain('window:Midday open');

    // The offline row's nightly restart "0 4 * * *" runs at 04:00 UTC.
    const offlineRuns = stored
      .filter((r) => r.serverId === offline.id)
      .map((r) => r.nextRunAt?.toISOString().slice(11));
    expect(offlineRuns).toEqual(['04:00:00.000Z']);
  });
});

describe('POST /admin/test/pelican/quick-play-fixture (ROK-1800)', () => {
  const FIXTURE = '/admin/test/pelican/quick-play-fixture';

  it('seeds a per-slot mapped + unmapped pair that a seed-servers reset leaves alone, and deletes it', async () => {
    const gameId = testApp.seed.game.id;
    const res = await testApp.request
      .post(FIXTURE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slot: 3, gameId });
    expect(res.status).toBe(200);
    const fixture = res.body as { mappedId: number; unmappedId: number };
    const ids = [fixture.mappedId, fixture.unmappedId];
    await testApp.db
      .update(schema.pelicanServers)
      .set({ presenceTracking: true })
      .where(eq(schema.pelicanServers.id, fixture.mappedId));

    await seed(); // a sibling spec's four-row reset mid-run
    const kept = await testApp.db.select().from(schema.pelicanServers);
    expect(kept).toHaveLength(6);
    expect(
      kept
        .filter((r) => ids.includes(r.id))
        .map((r) => [r.id, r.gameId, r.presenceTracking]),
    ).toEqual(
      expect.arrayContaining([
        [fixture.mappedId, gameId, true],
        [fixture.unmappedId, null, false],
      ]),
    );

    const again = await testApp.request
      .post(FIXTURE)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slot: 3, gameId });
    expect(again.body).toEqual(fixture); // same rows, switch reset off
    const [mapped] = await testApp.db
      .select()
      .from(schema.pelicanServers)
      .where(eq(schema.pelicanServers.id, fixture.mappedId));
    expect(mapped?.presenceTracking).toBe(false);

    const del = await testApp.request
      .delete(`${FIXTURE}/3`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(204);
    const left = await testApp.db.select().from(schema.pelicanServers);
    expect(left.filter((r) => ids.includes(r.id))).toEqual([]);
    expect(left).toHaveLength(4);
  });

  it('rejects a bad slot or game id with 400', async () => {
    const results = await Promise.all(
      [{ slot: 99, gameId: 1 }, { slot: 0 }, { slot: 1.5, gameId: 1 }].map(
        (body) =>
          testApp.request
            .post(FIXTURE)
            .set('Authorization', `Bearer ${adminToken}`)
            .send(body),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([400, 400, 400]);
  });
});
