import { PRESENCE_REPLAY_SETTLE_MS } from './pelican-presence.helpers';
import { PresenceDeathRecorder } from './pelican-presence.deaths';
import { PelicanPresenceSession } from './pelican-presence.session';
import {
  arrive,
  fakeLogger,
  fakeParser,
  fakeSink,
  fakeWings,
  line,
  okCredentials,
} from './pelican-presence.spec-fakes';
import type { GamePresenceEvent } from './presence-events';
import type { ServerDeathSink } from './server-death.sink';
import { ServerPresenceTracker } from './server-presence.tracker';

const SRC = { pelicanServerId: 7, gameId: 42 };
const A = '76561190000000001';
const T = (s: number) => `2026-10-15T10:00:${String(s).padStart(2, '0')}`;
const AT = new Date('2026-10-15T10:05:00Z');

const ev = {
  join: (steamId: string, loggedAt?: string): GamePresenceEvent => ({
    kind: 'join',
    steamId,
    ...(loggedAt ? { loggedAt } : {}),
  }),
  char: (
    name: string,
    zero: boolean,
    loggedAt?: string,
  ): GamePresenceEvent => ({
    kind: 'character',
    name,
    zdoidZero: zero,
    ...(zero ? {} : { ownerId: '99' }),
    ...(loggedAt ? { loggedAt } : {}),
  }),
};

function deathSink() {
  return { playerDied: jest.fn(() => Promise.resolve()) };
}

/**
 * Recorder + real tracker, fed in the session's order: observe, then apply.
 * `sink` is required (no default) so `recorderHarness(undefined)` really
 * binds no sink — a default parameter would fire on `undefined`.
 */
function recorderHarness(sink: ServerDeathSink | undefined) {
  const logger = { warn: jest.fn() };
  const tracker = new ServerPresenceTracker();
  const calls: Array<Promise<void>> = [];
  const recorder = new PresenceDeathRecorder({
    source: SRC,
    sink,
    logger,
    enqueue: (_method, call) => calls.push(call()),
  });
  const feed = (events: GamePresenceEvent[]) => {
    for (const e of events) {
      recorder.observe(e, tracker, AT);
      tracker.apply(e, AT);
    }
    return Promise.all(calls);
  };
  return { logger, recorder, feed, queued: () => calls.length };
}

describe('PresenceDeathRecorder (ROK-1930)', () => {
  it('reports a 0:0 death once, attributed to the paired player', async () => {
    const sink = deathSink();
    const h = recorderHarness(sink);
    await h.feed([ev.join(A, T(1)), ev.char('Bjorn', false, T(2))]);
    await h.feed([ev.char('Bjorn', true, T(3))]);
    expect(sink.playerDied).toHaveBeenCalledTimes(1);
    expect(sink.playerDied).toHaveBeenCalledWith(SRC, {
      characterName: 'Bjorn',
      steamId: A,
      loggedAt: T(3),
      at: AT,
    });
  });

  it('never reports a respawn (non-zero ZDOID of a known character)', async () => {
    const sink = deathSink();
    const h = recorderHarness(sink);
    await h.feed([
      ev.join(A, T(1)),
      ev.char('Bjorn', false, T(2)),
      ev.char('Bjorn', false, T(4)),
    ]);
    expect(sink.playerDied).not.toHaveBeenCalled();
  });

  it('a death of an unknown name is reported with a null SteamID', async () => {
    const sink = deathSink();
    const h = recorderHarness(sink);
    await h.feed([ev.char('Ghost', true, T(1))]);
    expect(sink.playerDied).toHaveBeenCalledWith(
      SRC,
      expect.objectContaining({ characterName: 'Ghost', steamId: null }),
    );
  });

  it('drops a death line with no timestamp and warns without the name', async () => {
    const sink = deathSink();
    const h = recorderHarness(sink);
    await h.feed([ev.join(A), ev.char('Bjorn', false), ev.char('Bjorn', true)]);
    expect(sink.playerDied).not.toHaveBeenCalled();
    expect(h.recorder.skippedCount).toBe(1);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    const [message] = h.logger.warn.mock.calls[0] ?? [];
    expect(message).toContain('character');
    expect(message).not.toContain('Bjorn');
  });

  it('does nothing and never throws with no sink bound', async () => {
    const h = recorderHarness(undefined);
    // toStrictEqual: toEqual treats `[undefined]` (one queued sink call) as `[]`.
    await expect(h.feed([ev.char('Bjorn', true, T(1))])).resolves.toStrictEqual(
      [],
    );
    expect(h.queued()).toBe(0);
    expect(h.logger.warn).not.toHaveBeenCalled();
  });
});

describe('PelicanPresenceSession death wiring (ROK-1930)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function connect(replay: string[]) {
    const sink = deathSink();
    const wings = fakeWings();
    const session = new PelicanPresenceSession({
      source: SRC,
      serverIdentifier: 'abc123',
      panelUrl: 'https://panel.test',
      getCredentials: okCredentials,
      parser: fakeParser,
      sink: fakeSink(),
      deathSink: sink,
      logger: fakeLogger(),
      socketFactory: wings.factory,
    });
    await session.start();
    await jest.advanceTimersByTimeAsync(0);
    wings.authenticate();
    wings.lines(replay);
    await jest.advanceTimersByTimeAsync(PRESENCE_REPLAY_SETTLE_MS);
    await session.idle();
    return { sink, wings, session };
  }

  const death = (loggedAt: string) =>
    line({ kind: 'character', name: 'Bjorn', zdoidZero: true, loggedAt });

  it('the replay path attributes against the roster at that line', async () => {
    const h = await connect([...arrive(A, 'Bjorn', T(1)), death(T(2))]);
    expect(h.sink.playerDied).toHaveBeenCalledTimes(1);
    expect(h.sink.playerDied).toHaveBeenCalledWith(
      SRC,
      expect.objectContaining({ steamId: A, loggedAt: T(2) }),
    );
  });

  it('the live path reports a death; a live respawn does not', async () => {
    const h = await connect(arrive(A, 'Bjorn', T(1)));
    h.wings.lines([
      death(T(3)),
      line({
        kind: 'character',
        name: 'Bjorn',
        zdoidZero: false,
        loggedAt: T(4),
      }),
    ]);
    await h.session.idle();
    expect(h.sink.playerDied).toHaveBeenCalledTimes(1);
    expect(h.sink.playerDied).toHaveBeenCalledWith(
      SRC,
      expect.objectContaining({ steamId: A, loggedAt: T(3) }),
    );
  });
});
