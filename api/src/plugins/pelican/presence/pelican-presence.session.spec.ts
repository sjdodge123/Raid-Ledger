import { Logger } from '@nestjs/common';
import type { ConsoleCredentialsSource } from '../pelican-console-socket';
import {
  PRESENCE_REPLAY_SETTLE_MS,
  PRESENCE_UNREACHABLE_EMPTY_MS,
} from './pelican-presence.helpers';
import { PelicanPresenceSession } from './pelican-presence.session';
import {
  arrive,
  fakeLogger,
  fakeParser,
  fakeSink,
  fakeWings,
  line,
  okCredentials,
  SECRET,
} from './pelican-presence.spec-fakes';
import type { ServerPresencePlayer } from './server-presence.sink';

const SRC = { pelicanServerId: 7, gameId: 42 };
const T = (s: number) => `2026-10-15T10:00:${String(s).padStart(2, '0')}`;

function harness(
  open: ServerPresencePlayer[] = [],
  getCredentials: ConsoleCredentialsSource = okCredentials,
) {
  const sink = fakeSink(open);
  const logger = fakeLogger();
  const wings = fakeWings();
  const session = new PelicanPresenceSession({
    source: SRC,
    serverIdentifier: 'abc123',
    panelUrl: 'https://panel.test',
    getCredentials,
    parser: fakeParser,
    sink,
    logger,
    socketFactory: wings.factory,
  });
  /** start → socket open → auth → replay `lines` → replay settles. */
  const connect = async (replay: string[] = []) => {
    await session.start();
    await jest.advanceTimersByTimeAsync(0);
    wings.authenticate();
    wings.lines(replay);
    await settle();
  };
  const settle = async () => {
    await jest.advanceTimersByTimeAsync(PRESENCE_REPLAY_SETTLE_MS);
    await session.idle();
  };
  const live = async (ls: string[]) => {
    wings.lines(ls);
    await session.idle();
  };
  return { sink, logger, wings, session, connect, settle, live };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('forwards live joins, renames and leaves to the sink', async () => {
  const h = harness();
  await h.connect();
  await h.live(arrive('A', 'Alice', T(1)));
  await h.live([
    line({ kind: 'join', steamId: 'B', loggedAt: T(2) }),
    line({ kind: 'heartbeat', count: 2, loggedAt: T(3) }),
    line({
      kind: 'character',
      name: 'Bob',
      zdoidZero: false,
      loggedAt: T(4),
    }),
    line({ kind: 'leave', steamId: 'A', loggedAt: T(5) }),
  ]);
  expect(h.sink.playerJoined.mock.calls).toEqual([
    [SRC, { steamId: 'A', displayName: 'Alice' }],
    [SRC, { steamId: 'B', displayName: 'B' }],
  ]);
  expect(h.sink.playerRenamed.mock.calls).toEqual([
    [SRC, { steamId: 'B', displayName: 'Bob' }],
  ]);
  expect(h.sink.playerLeft.mock.calls).toEqual([[SRC, 'A']]);
});

it('server-stopping empties the server once instead of per-player leaves', async () => {
  const h = harness();
  await h.connect(arrive('A', 'Alice', T(1)));
  await h.live([line({ kind: 'server-stopping', loggedAt: T(9) })]);
  await h.live([line({ kind: 'server-stopping', loggedAt: T(10) })]);
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
});

it('a Wings offline status push empties the server', async () => {
  const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
  await h.connect();
  h.wings.frame('status', 'offline');
  await h.session.idle();
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
});

it('rehydrates before the replay so already-present players re-emit nothing', async () => {
  const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
  await h.connect([
    ...arrive('A', 'Alice', T(1)),
    ...arrive('B', 'Bob', T(2)),
    line({ kind: 'leave', steamId: 'B', loggedAt: T(3) }),
  ]);
  expect(h.sink.openPresence).toHaveBeenCalledWith(SRC);
  expect(h.sink.playerJoined).not.toHaveBeenCalled();
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
  expect(h.sink.playerRenamed).not.toHaveBeenCalled();
});

it('a reconnect replay of already-processed lines emits nothing new', async () => {
  const h = harness();
  await h.connect();
  await h.live(arrive('A', 'Alice', T(1)));
  h.wings.sockets[0]?.handlers.onClose();
  await jest.advanceTimersByTimeAsync(65_000);
  h.wings.authenticate();
  h.wings.lines(arrive('A', 'Alice', T(1)));
  await h.settle();
  expect(h.sink.playerJoined).toHaveBeenCalledTimes(1);
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
});

it('empties once when unreachable past 15 min, and not before', async () => {
  const down: ConsoleCredentialsSource = () =>
    Promise.reject(new Error('down'));
  const h = harness([{ steamId: 'A', displayName: 'Alice' }], down);
  await h.session.start();
  await jest.advanceTimersByTimeAsync(PRESENCE_UNREACHABLE_EMPTY_MS - 61_000);
  await h.session.idle();
  expect(h.sink.serverEmptied).not.toHaveBeenCalled();
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(10 * 60_000);
  await h.session.idle();
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
});

it('re-enrols players still present after a timeout-driven empty (Codex r2)', async () => {
  let up = true;
  const flaky: ConsoleCredentialsSource = (id) =>
    up ? okCredentials(id) : Promise.reject(new Error('down'));
  const h = harness([], flaky);
  await h.connect();
  await h.live(arrive('A', 'Alice', T(1)));
  expect(h.sink.playerJoined).toHaveBeenCalledTimes(1);
  up = false;
  h.wings.sockets[0]?.handlers.onClose();
  await jest.advanceTimersByTimeAsync(PRESENCE_UNREACHABLE_EMPTY_MS + 60_000);
  await h.session.idle();
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
  up = true;
  await jest.advanceTimersByTimeAsync(5 * 60_000);
  expect(h.wings.sockets.length).toBeGreaterThan(1);
  h.wings.authenticate();
  h.wings.lines(arrive('A', 'Alice', T(1)));
  await h.settle();
  expect(h.sink.playerJoined).toHaveBeenCalledTimes(2);
  expect(h.sink.playerJoined).toHaveBeenLastCalledWith(SRC, {
    steamId: 'A',
    displayName: 'Alice',
  });
});

it('one failing sink call is logged and does not stop the next', async () => {
  const h = harness();
  h.sink.playerJoined.mockRejectedValueOnce(new TypeError('db down'));
  await h.connect();
  await h.live(arrive('A', 'Alice', T(1)));
  await h.live([line({ kind: 'leave', steamId: 'A', loggedAt: T(2) })]);
  expect(h.logger.error).toHaveBeenCalledWith(
    'Presence sink playerJoined failed for server 7: TypeError',
  );
  expect(h.sink.playerLeft.mock.calls).toEqual([[SRC, 'A']]);
});

it('never hands a raw console line to any logger', async () => {
  const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
    jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
  );
  const h = harness();
  await h.connect([`-password "${SECRET}"`, `boom ${SECRET}`]);
  await h.live([`noise ${SECRET}`, `boom ${SECRET}`]);
  const logged = JSON.stringify([
    ...spies.map((s) => s.mock.calls),
    h.logger.log.mock.calls,
    h.logger.warn.mock.calls,
    h.logger.error.mock.calls,
  ]);
  expect(h.logger.warn).toHaveBeenCalled();
  expect(logged).not.toContain(SECRET);
  spies.forEach((s) => s.mockRestore());
});

it('a cold-start replay never removes a rehydrated player (FB1 #1)', async () => {
  const h = harness([
    { steamId: 'A', displayName: 'Alice' },
    { steamId: 'B', displayName: 'Bob' },
  ]);
  await h.connect([
    line({ kind: 'heartbeat', count: 1, loggedAt: T(1) }),
    ...arrive('B', 'Bob', T(2)),
    ...arrive('C', 'Cara', T(3)),
  ]);
  expect(h.sink.playerLeft.mock.calls).toEqual([]);
  expect(h.sink.playerJoined.mock.calls).toEqual([
    [SRC, { steamId: 'C', displayName: 'Cara' }],
  ]);
  // A live heartbeat that disagrees still evicts the never-seen player.
  await h.live([line({ kind: 'heartbeat', count: 2, loggedAt: T(4) })]);
  expect(h.sink.playerLeft.mock.calls).toEqual([[SRC, 'A']]);
});

it('a re-auth inside the settle window keeps the buffered replay (FB1 #2)', async () => {
  const h = harness();
  await h.connect();
  h.wings.authenticate();
  h.wings.lines(arrive('A', 'Alice', T(1)));
  h.wings.frame('auth success');
  h.wings.lines(arrive('A', 'Alice', T(1)));
  await h.settle();
  expect(h.sink.playerJoined.mock.calls).toEqual([
    [SRC, { steamId: 'A', displayName: 'Alice' }],
  ]);
  expect(h.sink.playerLeft.mock.calls).toEqual([]);
});

it('a stop during rehydrate cancels the pending start — no socket opens (Codex r3)', async () => {
  const h = harness();
  let release: (open: ServerPresencePlayer[]) => void = () => undefined;
  h.sink.openPresence.mockImplementationOnce(
    () =>
      new Promise<ServerPresencePlayer[]>((resolve) => {
        release = resolve;
      }),
  );
  const starting = h.session.start();
  await h.session.stop(false);
  release([{ steamId: 'A', displayName: 'Alice' }]);
  await starting;
  await jest.advanceTimersByTimeAsync(0);
  expect(h.wings.sockets).toHaveLength(0);
});
