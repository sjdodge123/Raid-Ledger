/**
 * ROK-1773 — Pelican schedule sync against a real database. Every `it` drives
 * the real 15-min tick (`PelicanSyncService.syncServers()`); the panel is
 * faked at the `PelicanClient` boundary and serves `/servers/{uuid}/schedules`
 * from `panel.schedules` (absent uuid → 500).
 */
import { Logger } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanSchedulesRepository } from './pelican-schedules.repository';
import { PelicanSyncService } from './pelican-sync.service';
import {
  fakeSchedule,
  fakeServer,
  restartSchedule,
  type FakeTaskSpec,
} from './testing/pelican-fixtures';
import {
  FAKE_CLIENT_KEY,
  createFakePanel,
  scheduleUuids,
  schedulesOk,
  stubPanel,
  type FakePanel,
} from './testing/pelican-integration.helpers';

type ServerRow = typeof schema.pelicanServers.$inferSelect;
type ServerInsert = typeof schema.pelicanServers.$inferInsert;
type ScheduleRow = typeof schema.pelicanSchedules.$inferSelect;

const SECRET_PAYLOAD = 'say SECRET-RCON-xyz';
const SERVER_ERROR = { status: 500, body: { errors: [] } };

let testApp: TestApp;

const registry = () => testApp.app.get(PluginRegistryService);
const syncService = () => testApp.app.get(PelicanSyncService);
const schedulesRepo = () => testApp.app.get(PelicanSchedulesRepository);

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

/** A stored schedule row written straight to the DB (not via the sync). */
async function seedSchedule(serverId: number, panelScheduleId: number) {
  await testApp.db.insert(schema.pelicanSchedules).values({
    serverId,
    panelScheduleId,
    name: `Seeded ${panelScheduleId}`,
    cronMinute: '0',
    cronHour: '4',
    cronDayOfMonth: '*',
    cronMonth: '*',
    cronDayOfWeek: '*',
    effect: 'restart',
  });
}

async function allSchedules(): Promise<ScheduleRow[]> {
  return testApp.db
    .select()
    .from(schema.pelicanSchedules)
    .orderBy(asc(schema.pelicanSchedules.id));
}

async function schedulesOf(serverId: number): Promise<ScheduleRow[]> {
  return testApp.db
    .select()
    .from(schema.pelicanSchedules)
    .where(eq(schema.pelicanSchedules.serverId, serverId))
    .orderBy(asc(schema.pelicanSchedules.panelScheduleId));
}

/** `[panel_schedule_id, effect, effect_offset_s]` per stored row of a server. */
async function effectsOf(serverId: number) {
  return (await schedulesOf(serverId)).map((r) => [
    r.panelScheduleId,
    r.effect,
    r.effectOffsetS,
  ]);
}

/** Run one tick whose server listing must succeed. */
async function syncOk() {
  const outcome = await syncService().syncServers();
  expect(outcome.code).toBe('ok');
  return outcome;
}

/** A panel listing `ns`, stubbed in. */
function panelFor(ns: number[]): FakePanel {
  const panel = createFakePanel(ns.map((n) => fakeServer(n)));
  stubPanel(testApp, panel);
  return panel;
}

const command = (payload: string, offset = 0): FakeTaskSpec => ({
  action: 'command',
  payload,
  offset,
});
const power = (payload: string, offset = 0): FakeTaskSpec => ({
  action: 'power',
  payload,
  offset,
});

/** Every Logger line written from here on, as one string. */
function captureLogs(): () => string {
  const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
    (level) => jest.spyOn(Logger.prototype, level),
  );
  return () => spies.map((s) => JSON.stringify(s.mock.calls)).join('\n');
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
});

afterEach(async () => {
  jest.restoreAllMocks();
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('Pelican schedule sync — full replace (ROK-1773 AC1)', () => {
  it('stores every schedule, then a dropped or emptied panel list deletes the stale rows', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(
      server.panelUuid,
      schedulesOk([restartSchedule(1), fakeSchedule(2, [command('say hi')])]),
    );

    await syncOk();
    expect(await effectsOf(server.id)).toEqual([
      [1, 'restart', 0],
      [2, 'command', 0],
    ]);
    const [first] = nonEmpty(await schedulesOf(server.id), 'schedule 1');
    expect(first).toMatchObject({
      name: 'Fake Schedule 1',
      cronMinute: '0',
      cronHour: '4',
      cronDayOfMonth: '*',
      cronMonth: '*',
      cronDayOfWeek: '*',
      isActive: true,
      onlyWhenOnline: false,
      lastRunAt: null,
    });
    expect(first.nextRunAt?.toISOString()).toBe('2026-01-02T04:00:00.000Z');

    panel.schedules.set(server.panelUuid, schedulesOk([restartSchedule(1)]));
    await syncOk();
    expect(await effectsOf(server.id)).toEqual([[1, 'restart', 0]]);

    panel.schedules.set(server.panelUuid, schedulesOk([]));
    await syncOk();
    expect(await schedulesOf(server.id)).toEqual([]);
  });

  it('replaces in ONE transaction: an insert the DB rejects keeps the previous rows', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(server.panelUuid, schedulesOk([restartSchedule(1)]));
    await syncOk();
    const before = await allSchedules();
    expect(before).toHaveLength(1);

    // 97 tasks x 900 s puts the restart at 87 300 s — each task parses
    // (<= 900) but the row breaks the 0..86400 CHECK, after the DELETE ran.
    const tooLate = [
      ...Array.from({ length: 96 }, () => command('say wait', 900)),
      power('restart', 900),
    ];
    panel.schedules.set(
      server.panelUuid,
      schedulesOk([fakeSchedule(5, tooLate), restartSchedule(6)]),
    );
    await syncOk();
    expect(await allSchedules()).toEqual(before);
  });
});

describe('Pelican schedule sync — failed fetch keeps rows (ROK-1773 AC2)', () => {
  it('a 500 and a malformed body each leave the previous rows identical', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(
      server.panelUuid,
      schedulesOk([restartSchedule(1), restartSchedule(2)]),
    );
    await syncOk();
    const before = await allSchedules();
    expect(before).toHaveLength(2);

    panel.schedules.set(server.panelUuid, SERVER_ERROR);
    await syncOk();
    expect(await allSchedules()).toEqual(before);

    panel.schedules.set(server.panelUuid, {
      status: 200,
      body: { object: 'list', data: [{ object: 'server_schedule' }] },
    });
    await syncOk();
    expect(await allSchedules()).toEqual(before);
    expect(scheduleUuids(panel)).toEqual([
      server.panelUuid,
      server.panelUuid,
      server.panelUuid,
    ]);
  });
});

describe('Pelican schedule sync — per-server isolation (ROK-1773 AC3)', () => {
  it('an out-of-range offset and a garbage body skip only their server; the tick resolves ok', async () => {
    const a = await insertServer(1);
    const b = await insertServer(2);
    const c = await insertServer(3);
    const panel = panelFor([1, 2, 3]);
    for (const s of [a, b, c]) {
      panel.schedules.set(s.panelUuid, schedulesOk([restartSchedule(1)]));
    }
    await syncOk();
    const aBefore = await schedulesOf(a.id);
    const cBefore = await schedulesOf(c.id);
    expect(aBefore).toHaveLength(1);
    expect(cBefore).toHaveLength(1);

    panel.schedules.set(
      a.panelUuid,
      schedulesOk([fakeSchedule(9, [power('restart', 901)])]),
    );
    panel.schedules.set(
      b.panelUuid,
      schedulesOk([fakeSchedule(5, [command('say b')])]),
    );
    panel.schedules.set(c.panelUuid, {
      status: 200,
      body: { surprise: 'not a schedule list' },
    });

    const outcome = await syncOk();
    expect(outcome.markedMissing).toBe(0);
    expect(await schedulesOf(a.id)).toEqual(aBefore);
    expect(await schedulesOf(c.id)).toEqual(cBefore);
    expect(await effectsOf(b.id)).toEqual([[5, 'command', 0]]);
  });
});

describe('Pelican schedule sync — unmapped / hidden / missing (ROK-1773 AC4)', () => {
  it('fetches only mapped, visible, present servers and listServable() excludes the rest', async () => {
    const pollable = await insertServer(1);
    const unmapped = await insertServer(2, { gameId: null });
    const hidden = await insertServer(3, { showOnCalendar: false });
    const missing = await insertServer(4, { missingSince: new Date() });
    for (const s of [unmapped, hidden, missing]) await seedSchedule(s.id, 9);

    // Server 4 is not listed, so it stays missing.
    const panel = panelFor([1, 2, 3]);
    for (const s of [pollable, unmapped, hidden, missing]) {
      panel.schedules.set(s.panelUuid, schedulesOk([restartSchedule(1)]));
    }
    await syncOk();

    expect(scheduleUuids(panel)).toEqual([pollable.panelUuid]);
    const stored = (await allSchedules()).map((r) => r.serverId);
    expect([...stored].sort((x, y) => x - y)).toEqual(
      [pollable.id, unmapped.id, hidden.id, missing.id].sort((x, y) => x - y),
    );

    const servable = await schedulesRepo().listServable();
    expect(
      servable.map((r) => [r.serverId, r.panelScheduleId, r.gameId]),
    ).toEqual([[pollable.id, 1, testApp.seed.game.id]]);
    expect(
      (await schedulesRepo().listServable([testApp.seed.game.id])).map(
        (r) => r.serverId,
      ),
    ).toEqual([pollable.id]);
    expect(await schedulesRepo().listServable([])).toEqual([]);

    // Hiding a synced server drops it from the read path; its rows stay.
    await testApp.db
      .update(schema.pelicanServers)
      .set({ showOnCalendar: false })
      .where(eq(schema.pelicanServers.id, pollable.id));
    expect(await schedulesRepo().listServable()).toEqual([]);
    expect(await schedulesOf(pollable.id)).toHaveLength(1);
  });

  it('a failed listing makes no /schedules request', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(server.panelUuid, schedulesOk([restartSchedule(1)]));
    panel.failPage = 1;

    const outcome = await syncService().syncServers();
    expect(outcome.code).not.toBe('ok');
    expect(scheduleUuids(panel)).toEqual([]);
    expect(await allSchedules()).toEqual([]);
  });
});

describe('Pelican schedule sync — payloads never persisted (ROK-1773 AC5)', () => {
  it('no stored column and no log line carries a command payload', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(
      server.panelUuid,
      schedulesOk([
        fakeSchedule(1, [command(SECRET_PAYLOAD), power('restart', 30)]),
        fakeSchedule(2, [command(SECRET_PAYLOAD)]),
      ]),
    );
    const logs = captureLogs();

    await syncOk();
    expect(await effectsOf(server.id)).toEqual([
      [1, 'restart', 30],
      [2, 'command', 0],
    ]);

    const raw = await testApp.db.execute(sql`SELECT * FROM pelican_schedules`);
    const dump = JSON.stringify(raw);
    expect(dump).toContain('Fake Schedule 1');
    expect(dump).not.toContain('SECRET-RCON-xyz');

    const output = logs();
    for (const secret of [
      'SECRET-RCON-xyz',
      FAKE_CLIENT_KEY,
      server.panelUuid,
      server.name,
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('Pelican schedule sync — cumulative offsets (ROK-1773 AC6, Lead ruling Q1)', () => {
  it('stores the running sum of task offsets through the deriving task, past the old 900 s cap', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(
      server.panelUuid,
      schedulesOk([
        fakeSchedule(1, [
          command('say 5 min', 0),
          command('say 1 min', 60),
          power('restart', 300),
        ]),
        fakeSchedule(2, [
          command('say 30 min', 600),
          command('say 20 min', 600),
          power('stop', 600),
        ]),
        fakeSchedule(3, [power('restart', 900)]),
      ]),
    );

    await syncOk();
    // 1800 needs migration 0211's 0..86400 CHECK; under 0210's 0..900 the
    // whole replace rolls back and this reads [].
    expect(await effectsOf(server.id)).toEqual([
      [1, 'restart', 360],
      [2, 'stop', 1800],
      [3, 'restart', 900],
    ]);
  });
});

describe('Pelican schedule sync — plugin deactivated mid-tick (ROK-1773 AC7)', () => {
  it('a replace after deactivation writes nothing and keeps the previous rows', async () => {
    const server = await insertServer(1);
    const panel = panelFor([1]);
    panel.schedules.set(server.panelUuid, schedulesOk([restartSchedule(1)]));
    await syncOk();
    const before = await allSchedules();
    expect(before).toHaveLength(1);

    panel.schedules.set(
      server.panelUuid,
      schedulesOk([restartSchedule(7), restartSchedule(8)]),
    );
    panel.beforeSchedules = () => registry().deactivate(PELICAN_PLUGIN_ID);

    await syncService().syncServers();
    expect(registry().isActive(PELICAN_PLUGIN_ID)).toBe(false);
    expect(scheduleUuids(panel)).toEqual([server.panelUuid, server.panelUuid]);
    expect(await allSchedules()).toEqual(before);
  });
});
