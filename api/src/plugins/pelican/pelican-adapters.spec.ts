import {
  GameServerStatusSchema,
  type GameServerStatusDto,
} from '@raid-ledger/contract';
import {
  EXTENSION_POINTS,
  GAME_SERVER_PROVIDER_KEY,
  type CronRegistrar,
  type GameServerProvider,
} from '../plugin-host/extension-points';
import { PluginAdapterStore } from '../plugin-host/plugin-adapter-store';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { PelicanAdapterRegistration } from './pelican-adapters';
import { PelicanCronRegistrar } from './pelican-cron.registrar';
import { PelicanGameServerProvider } from './pelican-game-server.provider';
import type { PelicanClientFactory } from './pelican-client.factory';
import type { PelicanSchedulesRepository } from './pelican-schedules.repository';
import type { PelicanServersRepository } from './pelican-servers.repository';
import type { PelicanStatusService } from './pelican-status.service';
import type { PelicanSyncService } from './pelican-sync.service';
import { pelicanRow } from './testing/pelican-rows';

function cronRegistrar() {
  const sync = { syncServers: jest.fn(() => Promise.resolve({})) };
  const status = { pollStatuses: jest.fn(() => Promise.resolve({})) };
  const cron = new PelicanCronRegistrar(
    sync as unknown as PelicanSyncService,
    status as unknown as PelicanStatusService,
  );
  return { cron, sync, status };
}

function provider(rows = [pelicanRow(1)]) {
  const clients = {
    connect: jest.fn(() => Promise.resolve({ host: 'panel' })),
  };
  const repo = { listPollable: jest.fn(() => Promise.resolve(rows)) };
  const schedules = { listServable: jest.fn(() => Promise.resolve([])) };
  return new PelicanGameServerProvider(
    repo as unknown as PelicanServersRepository,
    schedules as unknown as PelicanSchedulesRepository,
    clients as unknown as PelicanClientFactory,
  );
}

/** Registers through a real adapter store so owner suspension is exercised. */
function register(active: { pelican: boolean }) {
  const store = new PluginAdapterStore(
    (id) => id !== 'pelican' || active.pelican,
  );
  const { cron } = cronRegistrar();
  const prov = provider();
  const registry = {
    registerAdapter: store.registerAdapter.bind(store),
    registerMultiAdapter: store.registerMultiAdapter.bind(store),
  };
  new PelicanAdapterRegistration(
    registry as unknown as PluginRegistryService,
    cron,
    prov,
  ).onModuleInit();
  const crons = () =>
    store.getAdaptersForExtensionPoint<CronRegistrar>(
      EXTENSION_POINTS.CRON_REGISTRAR,
    );
  const providers = () =>
    store.getMultiAdapters<GameServerProvider>(
      EXTENSION_POINTS.GAME_SERVER_PROVIDER,
      GAME_SERVER_PROVIDER_KEY,
    );
  return { store, cron, prov, crons, providers };
}

describe('PelicanCronRegistrar', () => {
  it('declares server-sync every 15 min and status-poll every 2 min', async () => {
    const { cron, sync, status } = cronRegistrar();
    const jobs = cron.getCronJobs();
    expect(jobs.map((j) => [j.name, j.cronExpression])).toEqual([
      ['server-sync', '0 */15 * * * *'],
      ['status-poll', '0 */2 * * * *'],
    ]);
    for (const job of jobs) await job.handler();
    expect(sync.syncServers).toHaveBeenCalledTimes(1);
    expect(status.pollStatuses).toHaveBeenCalledTimes(1);
  });
});

describe('PelicanAdapterRegistration', () => {
  it('registers the cron registrar and the provider while active', () => {
    const { crons, providers, cron, prov } = register({ pelican: true });
    expect(crons().get('pelican')).toBe(cron);
    expect(providers()).toEqual([prov]);
  });

  it('suspends both on deactivation and restores them on activation', () => {
    const state = { pelican: true };
    const { store, crons, providers, cron } = register(state);
    state.pelican = false;
    store.suspendAdaptersOwnedBy('pelican');
    expect(crons().has('pelican')).toBe(false);
    expect(providers()).toEqual([]);
    state.pelican = true;
    store.restoreAdaptersOwnedBy('pelican');
    expect(crons().get('pelican')).toBe(cron);
    expect(providers()).toHaveLength(1);
  });

  it('lands suspended when the plugin is inactive at boot', () => {
    const { crons, providers } = register({ pelican: false });
    expect(crons().has('pelican')).toBe(false);
    expect(providers()).toEqual([]);
  });
});

describe('PelicanGameServerProvider', () => {
  const checked = new Date(Date.now() - 60_000);

  it('returns member-safe status DTOs that parse against GameServerStatusSchema', async () => {
    const rows = [
      pelicanRow(1, {
        name: 'Valheim 10.0.0.5:2456',
        statusCheckedAt: checked,
      }),
      pelicanRow(2, { isSuspended: true, statusCheckedAt: checked, gameId: 8 }),
      pelicanRow(3),
    ];
    const out = await provider(rows).getStatuses();
    const parsed: GameServerStatusDto[] = out.map((s) =>
      GameServerStatusSchema.parse(s),
    );
    expect(parsed.map((s) => [s.serverKey, s.serverName, s.state])).toEqual([
      ['1', 'Valheim', 'running'],
      ['2', 'Fake Server 2', 'offline'],
    ]);
    const text = JSON.stringify(out);
    for (const r of rows) {
      expect(text).not.toContain(r.panelUuid);
      expect(text).not.toContain(r.identifier);
    }
  });

  it('filters by gameIds', async () => {
    const rows = [
      pelicanRow(1, { statusCheckedAt: checked, gameId: 7 }),
      pelicanRow(2, { statusCheckedAt: checked, gameId: 8 }),
    ];
    const out = await provider(rows).getStatuses([8]);
    expect(out.map((s) => s.serverKey)).toEqual(['2']);
  });

  it('returns no calendar items when no schedules are stored', async () => {
    const p = provider();
    const range = { from: new Date(0), to: new Date(86_400_000) };
    await expect(p.getCalendarItems(range)).resolves.toEqual([]);
    expect(p.pluginSlug).toBe('pelican');
    expect(p.providerLabel).toBe('Pelican');
  });
});
