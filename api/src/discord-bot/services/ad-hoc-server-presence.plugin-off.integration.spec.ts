/**
 * ROK-2355 review r1 M2 — Pelican turned off through the REAL plugin host
 * (`PluginRegistryService.deactivate`, its `plugin.deactivated` emit and the
 * sink's `@OnEvent` registration), against a real database: the sink's
 * below-threshold holds are dropped and none are written afterwards, so a
 * later join cannot reach the spawn threshold on presence no longer observed.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
import { steamPlayer } from '../../plugins/pelican/presence/presence-events';
import {
  SERVER_PRESENCE_SINK,
  type ServerPresenceSink,
  type ServerPresenceSource,
} from '../../plugins/pelican/presence/server-presence.sink';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';

const e = schema.events;
const STEAM_A = '76561198000002355';
const STEAM_B = '76561198000002356';

let testApp: TestApp;
let sink: ServerPresenceSink;
let serverSeq = 23550;

const registry = () => testApp.app.get(PluginRegistryService);

/** A fresh Pelican server id per test: the sink's holds live in memory. */
const source = (): ServerPresenceSource => ({
  pelicanServerId: ++serverSeq,
  gameId: testApp.seed.game.id,
});

const player = (steamId: string) => ({
  ...steamPlayer(steamId),
  displayName: `Viking-${steamId.slice(-3)}`,
});

const adHocEvents = () =>
  testApp.db
    .select()
    .from(e)
    .where(and(eq(e.isAdHoc, true), eq(e.gameId, testApp.seed.game.id)));

beforeAll(async () => {
  testApp = await getTestApp();
  sink = testApp.app.get<ServerPresenceSink>(SERVER_PRESENCE_SINK);
  const queue = testApp.app.get(AdHocGracePeriodQueueService);
  jest.spyOn(queue, 'enqueue').mockResolvedValue(undefined);
  jest.spyOn(queue, 'cancel').mockResolvedValue(undefined);
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  await registry().ensureInstalled(PELICAN_PLUGIN_ID);
  await registry().activate(PELICAN_PLUGIN_ID);
  await testApp.app
    .get(SettingsService)
    .set(schema.SETTING_KEYS.AD_HOC_EVENTS_ENABLED, 'true');
});

afterEach(async () => {
  // Leave Pelican on between tests: the sink's suspend flag follows its events.
  if (!registry().isActive(PELICAN_PLUGIN_ID))
    await registry().activate(PELICAN_PLUGIN_ID);
});

// No DB work in afterAll: the global integration-setup afterAll closes the
// pool first, so a query here fails with CONNECTION_ENDED. The next file
// truncates (and re-provisions the plugin rows) in its own beforeEach.
afterAll(() => {
  jest.restoreAllMocks();
});

describe('Pelican deactivated through the plugin host (ROK-2355)', () => {
  it('drops the held player and holds nobody afterwards, so no Quick Play spawns', async () => {
    const src = source();
    await sink.playerJoined(src, player(STEAM_A));
    expect(await sink.heldPresence(src)).toEqual([player(STEAM_A)]);

    await registry().deactivate(PELICAN_PLUGIN_ID);
    // Queued behind the deactivation's clear on this game's sink queue.
    await sink.playerJoined(src, player(STEAM_B));

    expect(await sink.heldPresence(src)).toEqual([]);
    // A + B would reach the default minPlayers (2) had either been held.
    expect(await adHocEvents()).toEqual([]);
  });

  it('holds again once Pelican is reactivated', async () => {
    const src = source();
    await registry().deactivate(PELICAN_PLUGIN_ID);
    await sink.playerJoined(src, player(STEAM_A));
    expect(await sink.heldPresence(src)).toEqual([]);

    await registry().activate(PELICAN_PLUGIN_ID);
    await sink.playerJoined(src, player(STEAM_A));
    expect(await sink.heldPresence(src)).toEqual([player(STEAM_A)]);
  });
});
