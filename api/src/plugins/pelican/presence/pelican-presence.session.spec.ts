import { Logger } from '@nestjs/common';
import type { GameLogParser } from '../../plugin-host/extension-points';
import { parseValheimLine } from '../../valheim/valheim-presence.parser';
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
  held: ServerPresencePlayer[] = [],
  parser: GameLogParser = fakeParser,
) {
  const sink = fakeSink(open, held);
  const logger = fakeLogger();
  const wings = fakeWings();
  const onChanged = jest.fn();
  const session = new PelicanPresenceSession({
    source: SRC,
    serverIdentifier: 'abc123',
    panelUrl: 'https://panel.test',
    getCredentials,
    parser,
    sink,
    logger,
    socketFactory: wings.factory,
    onChanged,
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
  return { sink, logger, wings, session, onChanged, connect, settle, live };
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
  // ROK-1802: a live heartbeat's count reaches the sink too.
  expect(h.sink.playerCount.mock.calls).toEqual([[SRC, 2]]);
});

it('server-stopping empties the server once instead of per-player leaves', async () => {
  const h = harness();
  await h.connect(arrive('A', 'Alice', T(1)));
  await h.live([line({ kind: 'server-stopping', loggedAt: T(9) })]);
  await h.live([line({ kind: 'server-stopping', loggedAt: T(10) })]);
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
  expect(h.sink.playerLeft).not.toHaveBeenCalled();
});

it('a stop with nobody tracked still empties the server once, clearing holds the tracker never knew (Codex r2 P3)', async () => {
  const h = harness();
  await h.connect();
  await h.live([line({ kind: 'server-stopping', loggedAt: T(9) })]);
  await h.live([line({ kind: 'server-stopping', loggedAt: T(10) })]);
  expect(h.sink.serverEmptied.mock.calls).toEqual([[SRC]]);
  expect(h.onChanged).not.toHaveBeenCalled();
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
  // ROK-1802: only the live count is forwarded — replay history is not.
  expect(h.sink.playerCount.mock.calls).toEqual([[SRC, 2]]);
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

it('ROK-1801: players() lists who is on the server now, tagged with its source', async () => {
  const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
  await h.connect();
  await h.live([
    line({ kind: 'join', steamId: 'B', loggedAt: T(2) }),
    line({ kind: 'heartbeat', count: 2, loggedAt: T(3) }),
  ]);
  expect(h.session.players()).toEqual([
    { pelicanServerId: 7, gameId: 42, steamId: 'A', name: 'Alice' },
    { pelicanServerId: 7, gameId: 42, steamId: 'B', name: null },
  ]);
});

it('ROK-1801: signals a change only after its sink call settled', async () => {
  const h = harness();
  await h.connect();
  let settled = 0;
  h.sink.playerJoined.mockImplementation(async () => {
    await Promise.resolve();
    settled += 1;
  });
  const seenSettled: number[] = [];
  h.onChanged.mockImplementation(() => seenSettled.push(settled));
  await h.live([...arrive('A', 'Alice', T(1)), ...arrive('B', 'Bob', T(2))]);
  expect(seenSettled).toEqual([1, 2]);
  expect(h.onChanged.mock.calls).toEqual([[SRC], [SRC]]);
});

it('ROK-1801: signals nothing for a reconnect replay that changes nothing', async () => {
  const h = harness();
  await h.connect();
  await h.live(arrive('A', 'Alice', T(1)));
  h.onChanged.mockClear();
  h.wings.sockets[0]?.handlers.onClose();
  await jest.advanceTimersByTimeAsync(65_000);
  h.wings.authenticate();
  h.wings.lines(arrive('A', 'Alice', T(1)));
  await h.settle();
  expect(h.onChanged).not.toHaveBeenCalled();
});

it('ROK-1801: signals after a rehydrate that restored players, and after an empty', async () => {
  const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
  await h.connect();
  // ROK-1831 Codex r2: the boot roster is marked, so a listener can tell it
  // from an arrival.
  const BOOT = { ...SRC, rehydrated: true };
  expect(h.onChanged.mock.calls).toEqual([[BOOT]]);
  h.wings.frame('status', 'offline');
  await h.session.idle();
  expect(h.onChanged.mock.calls).toEqual([[BOOT], [SRC]]);
  expect(h.session.players()).toEqual([]);
});

it('ROK-1801: a stop without emptying still signals (its roster is no longer read)', async () => {
  const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
  await h.connect();
  h.onChanged.mockClear();
  await h.session.stop(false);
  expect(h.onChanged.mock.calls).toEqual([[SRC]]);
  expect(h.sink.serverEmptied).not.toHaveBeenCalled();
});

it('ROK-1801: a throwing change listener is logged and never stops later sink calls', async () => {
  const h = harness();
  await h.connect();
  h.onChanged.mockImplementation(() => {
    throw new Error('listener down');
  });
  await h.live(arrive('A', 'Alice', T(1)));
  await h.live(arrive('B', 'Bob', T(2)));
  expect(h.sink.playerJoined).toHaveBeenCalledTimes(2);
  expect(h.logger.error.mock.calls).toEqual([
    ['Presence sink onChanged failed for server 7: Error'],
    ['Presence sink onChanged failed for server 7: Error'],
  ]);
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

describe('players the sink held before this session (ROK-1802 Codex r4)', () => {
  const A = { steamId: 'A', displayName: 'Alice' };
  const C = { steamId: 'C', displayName: 'C' };
  const beat = (count: number, s: number) =>
    line({ kind: 'heartbeat', count, loggedAt: T(s) });
  const left = (...ids: string[]) => ids.map((id) => [SRC, id]);

  it('a held player a heartbeat covered reports their disconnect line', async () => {
    const h = harness([], okCredentials, [A]);
    await h.connect();
    await h.live([beat(1, 1)]); // covers A: the sink may enrol them
    await h.live([line({ kind: 'leave', steamId: 'A', loggedAt: T(2) })]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left('A'));
    expect(h.sink.heldPresence).toHaveBeenCalledWith(SRC);
  });

  it('a zero-count heartbeat reports every tracked and held player gone', async () => {
    const h = harness([{ steamId: 'B', displayName: 'Bob' }], okCredentials, [
      A,
    ]);
    await h.connect();
    await h.live([beat(2, 1)]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left());
    await h.live([beat(0, 2)]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left('B', 'A'));
  });

  it('a lower count drops the oldest held player once tracked ones fill it', async () => {
    const h = harness([], okCredentials, [A, C]);
    await h.connect();
    await h.live([beat(2, 1)]);
    await h.live([beat(1, 2)]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left('A'));
  });

  it("a held player who re-joins is the tracker's from then on — one leave, not two", async () => {
    const h = harness([], okCredentials, [A]);
    await h.connect();
    await h.live(arrive('A', 'Alice', T(1)));
    expect(h.sink.playerJoined.mock.calls).toEqual([[SRC, A]]);
    await h.live([line({ kind: 'leave', steamId: 'A', loggedAt: T(2) })]);
    await h.live([beat(0, 3)]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left('A'));
  });

  it('an already-enrolled player is never also reported as held', async () => {
    const h = harness([A], okCredentials, [A]);
    await h.connect();
    await h.live([line({ kind: 'leave', steamId: 'A', loggedAt: T(1) })]);
    await h.live([beat(0, 2)]);
    expect(h.sink.playerLeft.mock.calls).toEqual(left('A'));
  });
});

describe('real Wings frames through the Valheim parser (ROK-1821 F2)', () => {
  const valheim: GameLogParser = {
    pluginSlug: 'valheim',
    parse: parseValheimLine,
  };
  const STEAM = '76561190000000001';
  const JOIN = `10/16/2026 17:27:02: Got handshake from client ${STEAM}`;
  const CHAR =
    '10/16/2026 17:27:09: Got character ZDOID from Thorvald : 123456789:1';
  const OLD_BEAT =
    '10/16/2026 17:20:00: Connections 0 ZDOS:1200  sent:0 recv:0';
  const logs = (h: ReturnType<typeof harness>) =>
    h.logger.log.mock.calls.map(([m]) => m);
  const thorvald = [
    SRC,
    { steamId: STEAM, displayName: 'Thorvald', characterOwnerId: '123456789' },
  ];

  it('missing test 4: a live join between two re-auth replays applies at once; the next replay adds 0 events', async () => {
    const h = harness([], okCredentials, [], valheim);
    await h.connect([OLD_BEAT]);
    // ScanReader rewrote the game's " \r" to "\r\n": two lines, ONE frame.
    h.wings.frame('console output', `${JOIN}\r\n${CHAR}`);
    await h.session.idle();
    expect(h.sink.playerJoined.mock.calls).toEqual([thorvald]);
    expect(logs(h)).toContain('Presence event for server 7: join (live)');
    // ~6 min later: token refresh → auth success → send-logs replay, one
    // \n-split line per frame (Wings Readlog).
    h.wings.frame('auth success');
    h.wings.lines([OLD_BEAT, JOIN, CHAR]);
    await h.settle();
    expect(logs(h)).toContain(
      'Presence replay for server 7: 0 events, 0 changes',
    );
    expect(logs(h)).toContain(
      'Presence re-auth for server 7: 2 live lines, 2 applied, 0 unparsed, 0 stale since the last auth',
    );
    expect(h.sink.playerJoined.mock.calls).toEqual([thorvald]);
    // Review MINOR 6: replayed events are summarised, never logged one by one.
    expect(logs(h)).not.toContainEqual(expect.stringMatching(/\(replay\)$/));
  });

  it('applies an ANSI-coloured live line with a trailing carriage return', async () => {
    const h = harness([], okCredentials, [], valheim);
    await h.connect();
    h.wings.frame('console output', JOIN);
    h.wings.frame('console output', `\u001b[0;32m${CHAR}\u001b[0m\r`);
    await h.session.idle();
    expect(h.sink.playerJoined.mock.calls).toEqual([thorvald]);
  });

  it('logs why it emptied the server (F6), with counts only', async () => {
    const h = harness([{ steamId: 'A', displayName: 'Alice' }]);
    await h.connect();
    h.wings.frame('status', 'offline');
    await h.session.idle();
    expect(logs(h)).toContain(
      'Presence: emptying server 7 (status offline); 1 tracked',
    );
  });
});

describe('character owner persistence (ROK-1822 r4)', () => {
  const ALICE = { steamId: 'A', displayName: 'Alice', characterOwnerId: '111' };
  const aliceAs = (ownerId: string, loggedAt: string) =>
    line({
      kind: 'character',
      name: 'Alice',
      zdoidZero: false,
      ownerId,
      loggedAt,
    });

  it('a live repeat handshake persists the cleared then adopted owner, with no join/leave', async () => {
    const h = harness([ALICE]);
    await h.connect();
    const notified = h.onChanged.mock.calls.length;
    await h.live([line({ kind: 'join', steamId: 'A', loggedAt: T(1) })]);
    await h.live([aliceAs('222', T(2))]);
    expect(h.sink.playerRenamed.mock.calls).toEqual([
      [SRC, { steamId: 'A', displayName: 'Alice' }],
      [SRC, { steamId: 'A', displayName: 'Alice', characterOwnerId: '222' }],
    ]);
    expect(h.sink.playerJoined).not.toHaveBeenCalled();
    expect(h.sink.playerLeft).not.toHaveBeenCalled();
    // An owner change is not a roster change.
    expect(h.onChanged.mock.calls.length).toBe(notified);
  });

  it('a cold replay persists its net owner change', async () => {
    const h = harness([ALICE]);
    await h.connect([
      line({ kind: 'join', steamId: 'A', loggedAt: T(1) }),
      aliceAs('222', T(2)),
    ]);
    expect(h.sink.playerRenamed.mock.calls).toEqual([
      [SRC, { steamId: 'A', displayName: 'Alice', characterOwnerId: '222' }],
    ]);
    expect(h.sink.playerJoined).not.toHaveBeenCalled();
  });

  it('a cold-replay restore keeps the owner, so a same-named stranger still joins', async () => {
    const h = harness([ALICE]);
    await h.connect([line({ kind: 'leave', steamId: 'A', loggedAt: T(1) })]);
    await h.live([
      line({ kind: 'join', steamId: 'B', loggedAt: T(2) }),
      aliceAs('999', T(3)),
    ]);
    expect(h.sink.playerJoined.mock.calls).toEqual([
      [SRC, { steamId: 'B', displayName: 'Alice', characterOwnerId: '999' }],
    ]);
    expect(h.sink.playerLeft).not.toHaveBeenCalled();
  });
});

describe('ROK-1831 Codex r3: replayed history is marked rehydrated', () => {
  const MARKED = { ...SRC, rehydrated: true };

  it('a cold-start replayed join is marked; a live join after catch-up is not', async () => {
    const h = harness();
    await h.connect(arrive('A', 'Alice', T(1)));
    expect(h.sink.playerJoined).toHaveBeenCalledTimes(1);
    expect(h.onChanged.mock.calls).toEqual([[MARKED]]);
    await h.live(arrive('B', 'Bob', T(2)));
    expect(h.onChanged.mock.calls).toEqual([[MARKED], [SRC]]);
  });

  it('a replay re-admitted after a timeout-driven empty is marked', async () => {
    let up = true;
    const flaky: ConsoleCredentialsSource = (id) =>
      up ? okCredentials(id) : Promise.reject(new Error('down'));
    const h = harness([], flaky);
    await h.connect();
    await h.live(arrive('A', 'Alice', T(1)));
    up = false;
    h.wings.sockets[0]?.handlers.onClose();
    await jest.advanceTimersByTimeAsync(PRESENCE_UNREACHABLE_EMPTY_MS + 60_000);
    await h.session.idle();
    h.onChanged.mockClear();
    up = true;
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    h.wings.authenticate();
    h.wings.lines(arrive('A', 'Alice', T(1)));
    await h.settle();
    expect(h.onChanged.mock.calls).toEqual([[MARKED]]);
  });
});
