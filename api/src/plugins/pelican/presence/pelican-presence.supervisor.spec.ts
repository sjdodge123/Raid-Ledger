import { Logger } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { SettingsService as SettingsToken } from '../../../settings/settings.service';
import { PLUGIN_EVENTS } from '../../plugin-host/plugin-manifest.interface';
import { PluginRegistryService as RegistryToken } from '../../plugin-host/plugin-registry.service';
import { PelicanClientFactory as FactoryToken } from '../pelican-client.factory';
import { PelicanPresenceRepository as RepoToken } from './pelican-presence.repository';
import { SERVER_PRESENCE_SINK } from './server-presence.sink';
import type { SettingsService } from '../../../settings/settings.service';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import type { PelicanClientFactory } from '../pelican-client.factory';
import { PRESENCE_REPLAY_SETTLE_MS } from './pelican-presence.helpers';
import type {
  PelicanPresenceRepository,
  PresenceServerRow,
} from './pelican-presence.repository';
import {
  PelicanPresenceSupervisor,
  PRESENCE_SOCKET_FACTORY,
} from './pelican-presence.supervisor';
import {
  fakeParser,
  fakeSink,
  fakeWings,
  okCredentials,
} from './pelican-presence.spec-fakes';
import type { ServerPresencePlayer } from './server-presence.sink';

function row(
  id: number,
  over: Partial<PresenceServerRow> = {},
): PresenceServerRow {
  return {
    id,
    identifier: `srv${id}`,
    gameId: 42,
    gameSlug: 'valheim',
    currentState: 'running',
    isSuspended: false,
    ...over,
  };
}

interface Opts {
  rows?: PresenceServerRow[];
  active?: boolean;
  adHoc?: boolean;
  panelUrl?: string | null;
  open?: ServerPresencePlayer[];
  noSink?: boolean;
}

function harness(opts: Opts = {}) {
  const state = { rows: opts.rows ?? [row(1)] };
  const registry = {
    isActive: jest.fn(() => opts.active ?? true),
    getAdapter: jest.fn((_point: string, slug: string) =>
      slug === 'valheim' ? fakeParser : undefined,
    ),
  };
  const factory = {
    connect: jest.fn(() =>
      Promise.resolve({
        client: { getWebsocketCredentials: okCredentials },
        host: 'panel.test',
      }),
    ),
    panelUrl: jest.fn(() =>
      Promise.resolve(
        opts.panelUrl === undefined ? 'https://panel.test' : opts.panelUrl,
      ),
    ),
  };
  const repo = { listTracked: jest.fn(() => Promise.resolve(state.rows)) };
  const settings = {
    getAdHocEventsEnabled: jest.fn(() => Promise.resolve(opts.adHoc ?? true)),
  };
  const sink = fakeSink(opts.open ?? []);
  const wings = fakeWings();
  const supervisor = new PelicanPresenceSupervisor(
    registry as unknown as PluginRegistryService,
    factory as unknown as PelicanClientFactory,
    repo as unknown as PelicanPresenceRepository,
    settings as unknown as SettingsService,
    opts.noSink ? null : sink,
    wings.factory,
  );
  const reconcile = async () => {
    await supervisor.reconcile();
    await jest.advanceTimersByTimeAsync(PRESENCE_REPLAY_SETTLE_MS);
  };
  const deps = { registry, factory, repo, settings };
  return { supervisor, sink, wings, state, reconcile, deps };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('opens a session only for tracked, running, unsuspended servers with a parser', async () => {
  const h = harness({
    rows: [
      row(1),
      row(2, { currentState: 'offline' }),
      row(3, { isSuspended: true }),
      row(4, { gameSlug: 'minecraft' }),
    ],
  });
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([1]);
  expect(h.wings.sockets).toHaveLength(1);
  // Server 1 rehydrates its session; offline server 2 is only probed for
  // stale presence to empty (FB1 #3) — no socket.
  expect(h.sink.openPresence.mock.calls).toEqual([
    [{ pelicanServerId: 1, gameId: 42 }],
    [{ pelicanServerId: 2, gameId: 42 }],
  ]);
});

it.each<[string, Opts]>([
  ['the Pelican plugin is inactive', { active: false }],
  ['Quick Play is disabled', { adHoc: false }],
  ['the panel is unconfigured', { panelUrl: null }],
])('opens nothing when %s', async (_label, opts) => {
  const h = harness(opts);
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(h.wings.sockets).toHaveLength(0);
});

it('opens nothing and warns once when no presence sink is bound', async () => {
  const warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
  const h = harness({ noSink: true });
  await h.reconcile();
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(warn.mock.calls).toEqual([
    ['No SERVER_PRESENCE_SINK bound — presence tracking off'],
  ]);
});

it('stops and empties a server that is no longer running', async () => {
  const h = harness({ open: [{ steamId: 'A', displayName: 'Alice' }] });
  await h.reconcile();
  h.state.rows = [row(1, { currentState: 'offline' })];
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(h.wings.sockets[0]?.close).toHaveBeenCalled();
  expect(h.sink.serverEmptied.mock.calls).toEqual([
    [{ pelicanServerId: 1, gameId: 42 }],
  ]);
});

it('shutdown closes sockets without emptying (a restart rehydrates)', async () => {
  const h = harness({ open: [{ steamId: 'A', displayName: 'Alice' }] });
  await h.reconcile();
  await h.supervisor.onModuleDestroy();
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(h.sink.serverEmptied).not.toHaveBeenCalled();
});

it('empties a server that stopped while no session watched it, once (FB1 #3)', async () => {
  const h = harness({
    rows: [row(1, { currentState: 'offline' })],
    open: [{ steamId: 'A', displayName: 'Alice' }],
  });
  await h.reconcile();
  await h.reconcile();
  expect(h.wings.sockets).toHaveLength(0);
  expect(h.sink.serverEmptied.mock.calls).toEqual([
    [{ pelicanServerId: 1, gameId: 42 }],
  ]);
});

it('does not empty a stopped server with no persisted presence (FB1 #3)', async () => {
  const h = harness({ rows: [row(1, { currentState: 'offline' })] });
  await h.reconcile();
  expect(h.sink.openPresence).toHaveBeenCalledTimes(1);
  expect(h.sink.serverEmptied.mock.calls).toEqual([]);
});

it('Pelican deactivation stops every session without emptying (FB1 #4)', async () => {
  const h = harness({ open: [{ steamId: 'A', displayName: 'Alice' }] });
  const app = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [
      { provide: PelicanPresenceSupervisor, useValue: h.supervisor },
      { provide: RegistryToken, useValue: h.deps.registry },
      { provide: FactoryToken, useValue: h.deps.factory },
      { provide: RepoToken, useValue: h.deps.repo },
      { provide: SettingsToken, useValue: h.deps.settings },
      { provide: SERVER_PRESENCE_SINK, useValue: h.sink },
      { provide: PRESENCE_SOCKET_FACTORY, useValue: h.wings.factory },
    ],
  }).compile();
  await app.init();
  await h.reconcile();
  const events = app.get(EventEmitter2);
  await events.emitAsync(PLUGIN_EVENTS.DEACTIVATED, { slug: 'valheim' });
  expect(h.supervisor.activeServerIds).toEqual([1]);
  await events.emitAsync(PLUGIN_EVENTS.DEACTIVATED, { slug: 'pelican' });
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(h.wings.sockets[0]?.close).toHaveBeenCalled();
  expect(h.sink.serverEmptied.mock.calls).toEqual([]);
  await app.close();
});
