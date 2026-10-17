/**
 * ROK-1800 (Codex r2) — the status poll feeds the presence supervisor, against
 * the real module graph and database:
 *  - the cron registrar holds the real supervisor (a `T | null` param with only
 *    `@Optional()` emitted `Object` metadata and resolved to null);
 *  - a presence-tracked server hidden from the calendar still gets a power
 *    state, while the calendar feed keeps excluding it.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from './pelican.constants';
import { PelicanCronRegistrar } from './pelican-cron.registrar';
import { PelicanServersRepository } from './pelican-servers.repository';
import { PelicanStatusService } from './pelican-status.service';
import { PelicanPresenceSupervisor } from './presence/pelican-presence.supervisor';
import { fakeServer } from './testing/pelican-fixtures';
import {
  createFakePanel,
  stubPanel,
} from './testing/pelican-integration.helpers';

type ServerRow = typeof schema.pelicanServers.$inferSelect;
type ServerInsert = typeof schema.pelicanServers.$inferInsert;

let testApp: TestApp;
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
        lastSyncedAt: new Date(),
        ...overrides,
      })
      .returning(),
    `pelican server ${n}`,
  );
  return row;
}

async function stateOf(id: number): Promise<string | null> {
  const [row] = nonEmpty(
    await testApp.db
      .select()
      .from(schema.pelicanServers)
      .where(eq(schema.pelicanServers.id, id)),
    `pelican server id ${id}`,
  );
  return row.currentState;
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

describe('Pelican status poll → presence supervisor (ROK-1800)', () => {
  it('the status-poll cron reconciles the real presence supervisor', async () => {
    const supervisor = testApp.app.get(PelicanPresenceSupervisor);
    const reconcile = jest
      .spyOn(supervisor, 'reconcile')
      .mockResolvedValue(undefined);
    const jobs = testApp.app.get(PelicanCronRegistrar).getCronJobs();
    const statusPoll = jobs.find((j) => j.name === 'status-poll');
    if (!statusPoll) throw new Error('status-poll job not registered');

    await statusPoll.handler();

    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('polls a presence-tracked server hidden from the calendar', async () => {
    const tracked = await insertServer(1, {
      showOnCalendar: false,
      presenceTracking: true,
    });
    const hidden = await insertServer(2, { showOnCalendar: false });
    const panel = createFakePanel([]);
    for (const r of [tracked, hidden]) {
      panel.live.set(r.panelUuid, { state: 'running', suspended: false });
    }
    stubPanel(testApp, panel);

    await testApp.app.get(PelicanStatusService).pollStatuses();

    expect(await stateOf(tracked.id)).toBe('running');
    expect(await stateOf(hidden.id)).toBeNull();
    const calendar = await testApp.app
      .get(PelicanServersRepository)
      .listPollable();
    expect(calendar.map((r) => r.id)).toEqual([]);
  });
});
