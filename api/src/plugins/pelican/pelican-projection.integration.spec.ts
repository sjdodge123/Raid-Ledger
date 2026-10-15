/**
 * ROK-1096 — stored Pelican schedules projected onto the member calendar,
 * end to end against a real database: `GET /game-servers/calendar` (any
 * member). Servers + schedules are written straight to the DB; nothing
 * talks to a panel.
 *
 * Range: 2026-11-02T12:00Z → 2026-11-03T12:00Z. Pelican crons are always UTC
 * (ROK-1795): the main server's stale `timezone = America/New_York` column is
 * ignored, so "0 23" projects at 23:00Z, "0 7" at 07:00Z and "0 9" at 09:00Z.
 */
import {
  GameServerCalendarItemSchema,
  GameServerCalendarResponseSchema,
  PelicanServerListResponseSchema,
  type GameServerCalendarItemDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import { fakeServer } from './testing/pelican-fixtures';
import { memberToken } from './testing/pelican-integration.helpers';
import { cronColumns } from './testing/pelican-schedule-rows';

type ServerRow = typeof schema.pelicanServers.$inferSelect;
type ServerInsert = typeof schema.pelicanServers.$inferInsert;
type ScheduleInsert = typeof schema.pelicanSchedules.$inferInsert;

const FROM = '2026-11-02T12:00:00.000Z';
const TO = '2026-11-03T12:00:00.000Z';
const NY = 'America/New_York';
/** Appears in a server name and a schedule name; must never reach a member. */
const ADDRESS = '203.0.113.7';
const RESTART_OFFSET_S = 300;
/** Server numbers: their fake uuids/identifiers are asserted absent. */
const N = {
  main: 0xa1,
  other: 0xa2,
  hidden: 0xa3,
  unmapped: 0xa4,
  missing: 0xa5,
};

const WINDOW_KEYS = [
  'end',
  'gameId',
  'kind',
  'label',
  'provider',
  'serverKey',
  'serverName',
  'source',
  'start',
];
const MARKER_KEYS = [
  'at',
  'effect',
  'gameId',
  'kind',
  'label',
  'provider',
  'serverKey',
  'serverName',
];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);

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
        currentState: 'running',
        lastSyncedAt: new Date(),
        ...overrides,
      })
      .returning(),
    `pelican server ${n}`,
  );
  return row;
}

let panelScheduleId = 1;

async function insertSchedule(
  serverId: number,
  expr: string,
  effect: string,
  overrides: Partial<ScheduleInsert> = {},
): Promise<void> {
  await testApp.db.insert(schema.pelicanSchedules).values({
    serverId,
    panelScheduleId: panelScheduleId++,
    name: '',
    ...cronColumns(expr),
    effect,
    ...overrides,
  });
}

async function insertSecondGame(): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Projection Other Game', slug: 'projection-other-game' })
      .returning({ id: schema.games.id }),
    'second game',
  );
  return game.id;
}

interface Seeded {
  main: ServerRow;
  other: ServerRow;
  hiddenEtc: ServerRow[];
  otherGameId: number;
}

/**
 * main (seeded game; stale NY column, ignored): start 23:00Z + stop 07:00Z +
 * restart 09:00Z (+300 s) + an INACTIVE backup 01:00Z. other (second game):
 * restart 06:00Z. hidden / unmapped / missing: restart 05:00Z — must not show.
 */
async function seedCalendar(): Promise<Seeded> {
  const otherGameId = await insertSecondGame();
  const main = await insertServer(N.main, {
    name: `Valheim ${ADDRESS}:2456`,
    // ROK-1795: a leftover override from before the fix — must be ignored.
    timezone: NY,
  });
  await insertSchedule(main.id, '0 23 * * *', 'start', {
    name: 'Evening open',
  });
  await insertSchedule(main.id, '0 7 * * *', 'stop', { name: 'Late close' });
  await insertSchedule(main.id, '0 9 * * *', 'restart', {
    name: `Nightly restart ${ADDRESS}:27015`,
    effectOffsetS: RESTART_OFFSET_S,
  });
  await insertSchedule(main.id, '0 1 * * *', 'backup', { isActive: false });
  const other = await insertServer(N.other, { gameId: otherGameId });
  await insertSchedule(other.id, '0 6 * * *', 'restart');
  const hiddenEtc = [
    await insertServer(N.hidden, { showOnCalendar: false }),
    await insertServer(N.unmapped, { gameId: null }),
    await insertServer(N.missing, { missingSince: new Date() }),
  ];
  for (const s of hiddenEtc) await insertSchedule(s.id, '0 5 * * *', 'restart');
  return { main, other, hiddenEtc, otherGameId };
}

async function getCalendar(token: string, extra = '') {
  const res = await testApp.request
    .get(
      `/game-servers/calendar?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}${extra}`,
    )
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const items = GameServerCalendarResponseSchema.parse(res.body).data.filter(
    (i) => i.provider === PELICAN_PROVIDER_LABEL,
  );
  return { res, items };
}

/** `[kind, serverKey, start|at, end|effect]`, chronological. */
function view(items: GameServerCalendarItemDto[]): string[][] {
  return items
    .map((i) =>
      i.kind === 'window'
        ? ['window', i.serverKey, i.start, i.end]
        : ['marker', i.serverKey, i.at, i.effect],
    )
    .sort((a, b) => (a[2] ?? '').localeCompare(b[2] ?? ''));
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
  if (registry().isActive(PELICAN_PLUGIN_ID)) {
    await registry().deactivate(PELICAN_PLUGIN_ID);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET /game-servers/calendar — Pelican projection (ROK-1096)', () => {
  it('projects one midnight-crossing window and offset restart markers, nothing from inactive/hidden/unmapped/missing', async () => {
    const { main, other } = await seedCalendar();
    const token = await memberToken(testApp, 'pelicanprojectionmember');
    const { items } = await getCalendar(token);
    const M = String(main.id);
    expect(view(items)).toEqual([
      ['window', M, '2026-11-02T23:00:00.000Z', '2026-11-03T07:00:00.000Z'],
      ['marker', String(other.id), '2026-11-03T06:00:00.000Z', 'restart'],
      // "0 9" UTC = 09:00Z, plus the 300 s cumulative task offset.
      ['marker', M, '2026-11-03T09:05:00.000Z', 'restart'],
    ]);
    const labels = items.map((i) => [i.serverKey, i.kind, i.label]);
    expect(labels).toContainEqual([M, 'window', 'Evening open']);
    expect(labels).toContainEqual([
      M,
      'marker',
      expect.stringContaining('Nightly restart'),
    ]);
    for (const i of items) expect(i.gameId).toBeGreaterThan(0);
  });

  it('honours gameIds', async () => {
    const { main, other, otherGameId } = await seedCalendar();
    const token = await memberToken(testApp, 'pelicangameidsmember');
    const keys = async (ids: number) =>
      [
        ...new Set(
          (await getCalendar(token, `&gameIds=${ids}`)).items.map(
            (i) => i.serverKey,
          ),
        ),
      ].sort();
    expect(await keys(testApp.seed.game.id)).toEqual([String(main.id)]);
    expect(await keys(otherGameId)).toEqual([String(other.id)]);
  });

  it('every item parses and carries no uuid, identifier, address or extra field', async () => {
    await seedCalendar();
    const token = await memberToken(testApp, 'pelicanleakmember');
    const { res, items } = await getCalendar(token);
    expect(items).toHaveLength(3);
    const raw = (res.body as { data: Record<string, unknown>[] }).data.filter(
      (i) => i.provider === PELICAN_PROVIDER_LABEL,
    );
    for (const item of raw) {
      expect(GameServerCalendarItemSchema.safeParse(item).success).toBe(true);
      const keys = Object.keys(item).sort();
      expect(keys).toEqual(item.kind === 'window' ? WINDOW_KEYS : MARKER_KEYS);
    }
    for (const n of Object.values(N)) {
      expect(res.text).not.toContain(fakeServer(n).uuid);
      expect(res.text).not.toContain(fakeServer(n).identifier);
    }
    expect(res.text).not.toContain(ADDRESS);
  });
});

describe('GET /admin/plugins/pelican/servers — no timezone fields (ROK-1795)', () => {
  it('lists rows without timezone or tzMismatch, even for a stale NY column', async () => {
    const server = await insertServer(N.main, { timezone: NY });
    await insertSchedule(server.id, '0 4 * * *', 'restart', {
      nextRunAt: new Date('2026-11-03T04:00:00.000Z'),
    });
    const res = await testApp.request
      .get('/admin/plugins/pelican/servers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const body = PelicanServerListResponseSchema.parse(res.body);
    expect(body.data.map((r) => r.id)).toEqual([server.id]);
    expect(res.text).not.toContain('timezone');
    expect(res.text).not.toContain('tzMismatch');
  });
});
