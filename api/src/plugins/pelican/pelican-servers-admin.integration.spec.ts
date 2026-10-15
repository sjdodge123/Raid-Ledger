/**
 * ROK-1094 — Pelican admin servers table against a real database:
 * `GET /admin/plugins/pelican/servers`, `PATCH /admin/plugins/pelican/servers/:id`.
 * Covers the leak-free row shape, the mapping edits (game, Show on calendar;
 * no timezone since ROK-1795 — Pelican crons are always UTC), the mapping
 * surviving a re-sync (incl. while missing),
 * the member-facing visibility filter and the guards.
 *
 * Visibility is proven here on `GET /game-servers/status` and the repository
 * filter; the calendar side (projected schedules, ROK-1096) is pinned in
 * `pelican-projection.integration.spec.ts`.
 */
import { eq } from 'drizzle-orm';
import {
  GameServerStatusResponseSchema,
  PelicanServerListResponseSchema,
  PelicanServerRowSchema,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID, PELICAN_PROVIDER_LABEL } from './pelican.constants';
import { PelicanServersRepository } from './pelican-servers.repository';
import { PelicanSyncService } from './pelican-sync.service';
import { fakeServer } from './testing/pelican-fixtures';
import {
  createFakePanel,
  memberToken,
  stubPanel,
} from './testing/pelican-integration.helpers';

type ServerRow = typeof schema.pelicanServers.$inferSelect;
type ServerInsert = typeof schema.pelicanServers.$inferInsert;

const SERVERS_ROUTE = '/admin/plugins/pelican/servers';
/** No `games` row ever gets this id in a fresh test DB. */
const UNKNOWN_GAME_ID = 987_654;
const UNKNOWN_SERVER_ID = 987_654;

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);

const getServers = (token = adminToken) =>
  testApp.request.get(SERVERS_ROUTE).set('Authorization', `Bearer ${token}`);

const patchServer = (id: number, body: object, token = adminToken) =>
  testApp.request
    .patch(`${SERVERS_ROUTE}/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

/** Insert server `n`; checked just now and running unless overridden. */
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
        gameId: null,
        currentState: 'running',
        statusCheckedAt: new Date(),
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

/** Pelican server keys a member sees on `GET /game-servers/status`. */
async function memberStatusKeys(token: string): Promise<string[]> {
  const res = await testApp.request
    .get('/game-servers/status')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const body = GameServerStatusResponseSchema.parse(res.body);
  return body.data
    .filter((d) => d.provider === PELICAN_PROVIDER_LABEL)
    .map((d) => d.serverKey)
    .sort();
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

describe('GET /admin/plugins/pelican/servers (ROK-1094)', () => {
  it('lists every row incl. a missing one, with the game name joined and no panel uuid/identifier', async () => {
    const mapped = await insertServer(1, { gameId: testApp.seed.game.id });
    const missing = await insertServer(2, { missingSince: new Date() });

    const res = await getServers();
    expect(res.status).toBe(200);
    const body = PelicanServerListResponseSchema.parse(res.body);
    expect(body.data.map((r) => [r.id, r.missing, r.gameName])).toEqual([
      [mapped.id, false, testApp.seed.game.name],
      [missing.id, true, null],
    ]);
    for (const row of res.body.data as Record<string, unknown>[]) {
      expect(Object.keys(row)).not.toContain('panelUuid');
      expect(Object.keys(row)).not.toContain('identifier');
    }
    expect(res.text).not.toContain(fakeServer(1).uuid);
    expect(res.text).not.toContain(fakeServer(2).uuid);
  });
});

describe('PATCH /admin/plugins/pelican/servers/:id — mapping (ROK-1094)', () => {
  it('persists a game mapping and returns the updated row', async () => {
    const server = await insertServer(1);
    const res = await patchServer(server.id, {
      gameId: testApp.seed.game.id,
    });
    expect(res.status).toBe(200);
    const row = PelicanServerRowSchema.parse(res.body);
    expect(row).toMatchObject({
      id: server.id,
      gameId: testApp.seed.game.id,
      gameName: testApp.seed.game.name,
    });
    expect(res.text).not.toContain(fakeServer(1).uuid);
    expect((await reload(server.id)).gameId).toBe(testApp.seed.game.id);
  });
});

describe('PATCH /admin/plugins/pelican/servers/:id — re-sync (ROK-1094)', () => {
  it('keeps the admin mapping across a re-sync, while missing, and after restore', async () => {
    const S1 = fakeServer(1);
    const S2 = fakeServer(2);
    const panel = createFakePanel([S1, S2]);
    stubPanel(testApp, panel);
    const sync = () => testApp.app.get(PelicanSyncService).syncServers();
    expect((await sync()).code).toBe('ok');
    const [listed] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.pelicanServers)
        .where(eq(schema.pelicanServers.panelUuid, S1.uuid)),
      'synced S1',
    );
    const gameId = testApp.seed.game.id;
    const mapping = { gameId, showOnCalendar: false };
    expect((await patchServer(listed.id, mapping)).status).toBe(200);

    panel.servers = [{ ...S1, name: 'Renamed On Panel' }, S2];
    expect((await sync()).code).toBe('ok');
    expect(await reload(listed.id)).toMatchObject({
      name: 'Renamed On Panel',
      ...mapping,
    });

    panel.servers = [S2];
    expect((await sync()).code).toBe('ok');
    const gone = await reload(listed.id);
    expect(gone.missingSince).toBeInstanceOf(Date);
    expect(gone).toMatchObject(mapping);

    const editedWhileMissing = await patchServer(listed.id, {
      showOnCalendar: true,
    });
    expect(editedWhileMissing.status).toBe(200);
    expect(editedWhileMissing.body).toMatchObject({ missing: true });

    panel.servers = [S1, S2];
    expect((await sync()).code).toBe('ok');
    expect(await reload(listed.id)).toMatchObject({
      missingSince: null,
      gameId,
      showOnCalendar: true,
    });
  });
});

describe('PATCH /admin/plugins/pelican/servers/:id — visibility (ROK-1094)', () => {
  it('hiding or unmapping a server removes it from the member status feed', async () => {
    const gameId = testApp.seed.game.id;
    const kept = await insertServer(1, { gameId });
    const hidden = await insertServer(2, { gameId });
    const unmapped = await insertServer(3, { gameId });
    // A configured plugin — unconfigured returns no statuses (ROK-1776).
    stubPanel(testApp, createFakePanel([]));
    const token = await memberToken(testApp, 'pelicanvisibilitymember');
    expect(await memberStatusKeys(token)).toEqual(
      [kept.id, hidden.id, unmapped.id].map(String).sort(),
    );

    expect(
      (await patchServer(hidden.id, { showOnCalendar: false })).status,
    ).toBe(200);
    expect((await patchServer(unmapped.id, { gameId: null })).status).toBe(200);

    expect(await memberStatusKeys(token)).toEqual([String(kept.id)]);
    // The repository filter itself, not only the later status-feed filter:
    // dropping either `isNotNull(gameId)` or `showOnCalendar` must go red.
    const pollable = await testApp.app
      .get(PelicanServersRepository)
      .listPollable();
    expect(pollable.map((r) => r.id)).toEqual([kept.id]);
    expect(await reload(unmapped.id)).toMatchObject({ gameId: null });
    expect(await reload(hidden.id)).toMatchObject({ showOnCalendar: false });
  });
});

describe('PATCH /admin/plugins/pelican/servers/:id — no timezone (ROK-1795)', () => {
  it('rejects the removed timezone field with 400 and leaves the row unchanged', async () => {
    const server = await insertServer(1);
    const res = await patchServer(server.id, { timezone: 'America/Chicago' });
    expect(res.status).toBe(400);
    expect(await reload(server.id)).toMatchObject({
      timezone: null,
      showOnCalendar: true,
    });
  });
});

describe('PATCH /admin/plugins/pelican/servers/:id — rejects (ROK-1094)', () => {
  it('returns 404 for an unknown server id', async () => {
    const res = await patchServer(UNKNOWN_SERVER_ID, { showOnCalendar: false });
    expect(res.status).toBe(404);
  });

  it('returns 400 for an unknown game and leaves the row unchanged', async () => {
    const gameId = testApp.seed.game.id;
    const server = await insertServer(1, { gameId });
    const res = await patchServer(server.id, { gameId: UNKNOWN_GAME_ID });
    expect(res.status).toBe(400);
    expect((await reload(server.id)).gameId).toBe(gameId);
  });

  it('returns 400 for an empty body and changes nothing', async () => {
    const server = await insertServer(1);
    const res = await patchServer(server.id, {});
    expect(res.status).toBe(400);
    expect(await reload(server.id)).toMatchObject({
      showOnCalendar: true,
      gameId: null,
    });
  });
});

describe('/admin/plugins/pelican/servers guards (ROK-1094)', () => {
  it('rejects a non-admin member with 403 on GET and PATCH', async () => {
    const server = await insertServer(1);
    const token = await memberToken(testApp, 'pelicanserversmember');
    const results = [
      await getServers(token),
      await patchServer(server.id, { showOnCalendar: false }, token),
    ];
    expect(results.map((r) => r.status)).toEqual([403, 403]);
    expect((await reload(server.id)).showOnCalendar).toBe(true);
  });

  it('rejects GET and PATCH with 403 while the plugin is deactivated', async () => {
    const server = await insertServer(1);
    await registry().deactivate(PELICAN_PLUGIN_ID);
    const results = [
      await getServers(),
      await patchServer(server.id, { showOnCalendar: false }),
    ];
    expect(results.map((r) => r.status)).toEqual([403, 403]);
    expect((await reload(server.id)).showOnCalendar).toBe(true);
  });
});

describe('Quick Play detection switch (ROK-1800)', () => {
  /** Only the seed game's slug has a `game-log-parser` adapter. */
  async function parserForSeedGame(): Promise<number> {
    const gameId = testApp.seed.game.id;
    const [game] = nonEmpty(
      await testApp.db
        .select({ slug: schema.games.slug })
        .from(schema.games)
        .where(eq(schema.games.id, gameId)),
      'seed game',
    );
    const real = registry().getAdapter.bind(registry());
    const parser = { pluginSlug: 'test', parse: () => null };
    const fake = (point: string, slug: string): unknown =>
      point === EXTENSION_POINTS.GAME_LOG_PARSER && slug === game.slug
        ? parser
        : real(point, slug);
    jest.spyOn(registry(), 'getAdapter').mockImplementation(fake);
    return gameId;
  }

  it('PATCH { presenceTracking } persists and GET reports it with presenceSupported', async () => {
    const gameId = await parserForSeedGame();
    const mapped = await insertServer(1, { gameId });
    const unmapped = await insertServer(2);

    const res = await patchServer(mapped.id, { presenceTracking: true });
    expect(res.status).toBe(200);
    expect(PelicanServerRowSchema.parse(res.body)).toMatchObject({
      presenceTracking: true,
      presenceSupported: true,
    });
    expect(await reload(mapped.id)).toMatchObject({ presenceTracking: true });

    const list = PelicanServerListResponseSchema.parse(
      (await getServers()).body,
    );
    const byId = new Map(list.data.map((r) => [r.id, r]));
    expect(byId.get(mapped.id)).toMatchObject({
      presenceTracking: true,
      presenceSupported: true,
    });
    expect(byId.get(unmapped.id)).toMatchObject({
      presenceTracking: false,
      presenceSupported: false,
    });
  });

  it('a member cannot flip it (admin guard)', async () => {
    const server = await insertServer(1);
    const token = await memberToken(testApp, 'pelicanpresencemember');
    const res = await patchServer(server.id, { presenceTracking: true }, token);
    expect(res.status).toBe(403);
    expect(await reload(server.id)).toMatchObject({ presenceTracking: false });
  });
});
