import { Logger } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { SettingsService as SettingsToken } from '../../../settings/settings.service';
import { PLUGIN_EVENTS } from '../../plugin-host/plugin-manifest.interface';
import { PELICAN_PRESENCE_CONFIG_CHANGED } from '../pelican.constants';
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
import { SERVER_PRESENCE_EVENTS } from './server-presence.reader';

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
  const events = { emit: jest.fn() };
  const supervisor = new PelicanPresenceSupervisor(
    registry as unknown as PluginRegistryService,
    factory as unknown as PelicanClientFactory,
    repo as unknown as PelicanPresenceRepository,
    settings as unknown as SettingsService,
    events as unknown as EventEmitter2,
    opts.noSink ? null : sink,
    wings.factory,
  );
  const reconcile = async () => {
    await supervisor.reconcile();
    await jest.advanceTimersByTimeAsync(PRESENCE_REPLAY_SETTLE_MS);
  };
  const deps = { registry, factory, repo, settings };
  return { supervisor, sink, wings, state, reconcile, deps, events };
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

async function eventBus(h: ReturnType<typeof harness>) {
  const app = await Test.createTestingModule({
    imports: [EventEmitterModule.forRoot()],
    providers: [{ provide: PelicanPresenceSupervisor, useValue: h.supervisor }],
  }).compile();
  await app.init();
  return { app, events: app.get(EventEmitter2) };
}

it('an admin Quick Play toggle reconciles at once, not at the next status poll (ROK-1800 n4)', async () => {
  const h = harness({ rows: [] });
  const { app, events } = await eventBus(h);
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([]);

  h.state.rows = [row(1)]; // switched on
  await events.emitAsync(PELICAN_PRESENCE_CONFIG_CHANGED, { serverId: 1 });
  await jest.advanceTimersByTimeAsync(PRESENCE_REPLAY_SETTLE_MS);
  expect(h.supervisor.activeServerIds).toEqual([1]);

  h.state.rows = []; // switched off
  await events.emitAsync(PELICAN_PRESENCE_CONFIG_CHANGED, { serverId: 1 });
  expect(h.supervisor.activeServerIds).toEqual([]);
  expect(h.wings.sockets[0]?.close).toHaveBeenCalled();
  await app.close();
});

it('a reconcile asked for mid-run runs once more instead of being dropped (ROK-1800 n4)', async () => {
  const h = harness({ rows: [] });
  h.deps.repo.listTracked.mockImplementationOnce(() => {
    h.state.rows = [row(1)]; // the toggle lands while this pass reads
    void h.supervisor.reconcile();
    return Promise.resolve([]);
  });
  await h.reconcile();
  expect(h.supervisor.activeServerIds).toEqual([1]);
  expect(h.deps.repo.listTracked).toHaveBeenCalledTimes(2);
});

it('a reconnect fetches socket credentials from the CURRENT client (Codex r2)', async () => {
  const h = harness();
  await h.reconcile();
  h.wings.authenticate();
  const rotated = jest.fn(okCredentials);
  h.deps.factory.connect.mockImplementation(() =>
    Promise.resolve({
      client: { getWebsocketCredentials: rotated },
      host: 'panel.test',
    }),
  );
  h.wings.sockets[0]?.handlers.onClose();
  await jest.advanceTimersByTimeAsync(65_000);
  expect(rotated).toHaveBeenCalledWith('srv1');
  expect(h.supervisor.activeServerIds).toEqual([1]);
  expect(h.sink.serverEmptied).not.toHaveBeenCalled();
});

describe('ROK-1801 read port', () => {
  const ALICE = { steamId: 'A', displayName: 'Alice' };
  const UNNAMED = { steamId: 'B', displayName: 'B' };
  const changed = (pelicanServerId: number, gameId = 42) => [
    SERVER_PRESENCE_EVENTS.CHANGED,
    { pelicanServerId, gameId },
  ];

  it('reads every open session, and per game across all its servers', async () => {
    const h = harness({
      rows: [row(1), row(2), row(3, { gameId: 43 })],
      open: [ALICE, UNNAMED],
    });
    await h.reconcile();
    const on = (pelicanServerId: number, gameId = 42) => [
      { pelicanServerId, gameId, steamId: 'A', name: 'Alice' },
      { pelicanServerId, gameId, steamId: 'B', name: null },
    ];
    expect(h.supervisor.playersOnGames()).toEqual([
      ...on(1),
      ...on(2),
      ...on(3, 43),
    ]);
    expect(h.supervisor.playersForGame(42)).toEqual([...on(1), ...on(2)]);
    expect(h.supervisor.playersForGame(43)).toEqual(on(3, 43));
    expect(h.supervisor.playersForGame(99)).toEqual([]);
  });

  it('reads nothing while no session is open', async () => {
    const h = harness({ active: false, open: [ALICE] });
    await h.reconcile();
    expect(h.supervisor.playersOnGames()).toEqual([]);
  });

  it('emits CHANGED with the server and its game when a roster changes', async () => {
    const h = harness({
      rows: [row(1), row(3, { gameId: 43 })],
      open: [ALICE],
    });
    await h.reconcile();
    expect(h.events.emit.mock.calls).toEqual([changed(1), changed(3, 43)]);
  });

  it('deactivation empties the read roster and emits CHANGED', async () => {
    const h = harness({ open: [ALICE] });
    await h.reconcile();
    h.events.emit.mockClear();
    await h.supervisor.handlePluginDeactivated({ slug: 'pelican' });
    expect(h.supervisor.playersOnGames()).toEqual([]);
    expect(h.events.emit.mock.calls).toEqual([changed(1)]);
  });
});
