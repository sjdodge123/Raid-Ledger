import type { GamePresenceEvent } from './presence-events';
import {
  ServerPresenceTracker,
  presenceDisplayName,
  type PresenceChange,
} from './server-presence.tracker';

const A = '76561190000000001';
const B = '76561190000000002';
const C = '76561190000000003';

const join = (steamId: string): GamePresenceEvent => ({
  kind: 'join',
  steamId,
});
const leave = (steamId: string): GamePresenceEvent => ({
  kind: 'leave',
  steamId,
});
const authFailed = (steamId: string): GamePresenceEvent => ({
  kind: 'auth-failed',
  steamId,
});
const character = (name: string, zdoidZero = false): GamePresenceEvent => ({
  kind: 'character',
  name,
  zdoidZero,
});
/** A live character line carrying its ZDOID owner id (ROK-1802). */
const characterOf = (name: string, ownerId: string): GamePresenceEvent => ({
  kind: 'character',
  name,
  zdoidZero: false,
  ownerId,
});
const heartbeat = (count: number): GamePresenceEvent => ({
  kind: 'heartbeat',
  count,
});

/** Feed events at t = 1s, 2s, … and collect every change. */
function run(
  tracker: ServerPresenceTracker,
  events: GamePresenceEvent[],
  startSec = 1,
): PresenceChange[] {
  return events.flatMap((e, i) =>
    tracker.apply(e, new Date((startSec + i) * 1000)),
  );
}

let tracker: ServerPresenceTracker;
beforeEach(() => {
  tracker = new ServerPresenceTracker();
});

describe('ServerPresenceTracker — join + character pairing', () => {
  it('keeps a bare handshake pending (no change, not present)', () => {
    expect(run(tracker, [join(A)])).toEqual([]);
    expect(tracker.snapshot()).toEqual([]);
  });

  it('promotes a handshake to joined when its character line arrives', () => {
    expect(run(tracker, [join(A), character('Ragnhild')])).toEqual([
      { kind: 'joined', steamId: A, name: 'Ragnhild' },
    ]);
    expect(tracker.snapshot()).toEqual([{ steamId: A, name: 'Ragnhild' }]);
  });

  it('pairs character lines to handshakes FIFO', () => {
    const changes = run(tracker, [
      join(A),
      join(B),
      character('X'),
      character('Y'),
    ]);
    expect(changes).toEqual([
      { kind: 'joined', steamId: A, name: 'X' },
      { kind: 'joined', steamId: B, name: 'Y' },
    ]);
  });

  it('a repeat handshake from a present player changes nothing', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [join(A), character('Y')], 10)).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ steamId: A, name: 'X' }]);
  });
});

describe('ServerPresenceTracker — death and respawn', () => {
  it('a 0:0 death of a present player does not leave', () => {
    run(tracker, [join(A), character('Bjorn')]);
    expect(
      run(tracker, [character('Bjorn', true), character('Bjorn')], 10),
    ).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ steamId: A, name: 'Bjorn' }]);
  });

  it('a respawn does not consume a newer pending handshake', () => {
    run(tracker, [join(A), character('Bjorn'), join(B)]);
    expect(run(tracker, [character('Bjorn'), character('Freya')], 10)).toEqual([
      { kind: 'joined', steamId: B, name: 'Freya' },
    ]);
  });

  it('a 0:0 line never pairs to a pending handshake', () => {
    expect(run(tracker, [join(B), character('Ghost', true)])).toEqual([]);
    expect(tracker.snapshot()).toEqual([]);
  });
});

describe('ServerPresenceTracker — duplicate character names (ROK-1802)', () => {
  it('a second player sharing a name is promoted from their own handshake', () => {
    run(tracker, [join(A), characterOf('Bjorn', '111'), join(B)]);
    expect(run(tracker, [characterOf('Bjorn', '222')], 10)).toEqual([
      { kind: 'joined', steamId: B, name: 'Bjorn' },
    ]);
    expect(tracker.snapshot()).toEqual([
      { steamId: A, name: 'Bjorn' },
      { steamId: B, name: 'Bjorn' },
    ]);
  });

  it('each same-named player respawns as themselves, never consuming a handshake', () => {
    run(tracker, [
      join(A),
      characterOf('Bjorn', '111'),
      join(B),
      characterOf('Bjorn', '222'),
      join(C),
    ]);
    const respawns = [characterOf('Bjorn', '222'), characterOf('Bjorn', '111')];
    expect(run(tracker, respawns, 10)).toEqual([]);
    expect(run(tracker, [characterOf('Freya', '333')], 20)).toEqual([
      { kind: 'joined', steamId: C, name: 'Freya' },
    ]);
  });

  it('a hydrated player adopts the owner id of their first respawn line', () => {
    tracker.hydrate([{ steamId: A, name: 'Bjorn' }]);
    run(tracker, [join(B)]);
    expect(run(tracker, [characterOf('Bjorn', '111')], 10)).toEqual([]);
    expect(run(tracker, [characterOf('Bjorn', '222')], 20)).toEqual([
      { kind: 'joined', steamId: B, name: 'Bjorn' },
    ]);
  });
});

describe('ServerPresenceTracker — a repeat handshake rebinds the owner (ROK-1802 Codex P2)', () => {
  it('a reconnect whose disconnect was missed respawns as itself, never taking a stranger’s handshake', () => {
    run(tracker, [join(A), characterOf('Bjorn', '111')]);
    // A's disconnect is lost in a socket outage; A logs back in (new owner),
    // and B's handshake is pending behind it.
    run(tracker, [join(A), join(B)], 10);
    expect(run(tracker, [characterOf('Bjorn', '333')], 20)).toEqual([]);
    expect(run(tracker, [characterOf('Bjorn', '333')], 30)).toEqual([]);
    expect(run(tracker, [characterOf('Freya', '444')], 40)).toEqual([
      { kind: 'joined', steamId: B, name: 'Freya' },
    ]);
  });
});

describe('ServerPresenceTracker — auth-failed', () => {
  it('retracts the pending handshake with no joined/left churn', () => {
    expect(run(tracker, [join(B), authFailed(B), character('X')])).toEqual([]);
    expect(tracker.snapshot()).toEqual([]);
  });

  it('retracts only that handshake — the next character pairs to the other', () => {
    expect(
      run(tracker, [join(B), join(A), authFailed(B), character('X')]),
    ).toEqual([{ kind: 'joined', steamId: A, name: 'X' }]);
  });
});

describe('ServerPresenceTracker — leave', () => {
  it('removes a present player and reports their name', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [leave(A)], 10)).toEqual([
      { kind: 'left', steamId: A, name: 'X' },
    ]);
    expect(tracker.snapshot()).toEqual([]);
  });

  it('drops a pending handshake silently', () => {
    expect(run(tracker, [join(A), leave(A), character('X')])).toEqual([]);
  });

  it('ignores an unknown SteamID', () => {
    expect(run(tracker, [leave(C)])).toEqual([]);
  });
});

describe('ServerPresenceTracker — heartbeat reconcile', () => {
  it('N=0 leaves everyone and clears pending handshakes', () => {
    run(tracker, [join(A), character('X'), join(B), character('Y'), join(C)]);
    expect(run(tracker, [heartbeat(0)], 10)).toEqual([
      { kind: 'left', steamId: A, name: 'X' },
      { kind: 'left', steamId: B, name: 'Y' },
    ]);
    expect(run(tracker, [character('Z')], 20)).toEqual([]);
  });

  it('N < tracked leaves the longest-silent players', () => {
    // A joins t2, B t4, C t6; A's death line at t7 makes B the most silent.
    run(tracker, [
      join(A),
      character('X'),
      join(B),
      character('Y'),
      join(C),
      character('Z'),
      character('X', true),
    ]);
    expect(run(tracker, [heartbeat(2)], 10)).toEqual([
      { kind: 'left', steamId: B, name: 'Y' },
    ]);
    expect(tracker.snapshot().map((p) => p.steamId)).toEqual([A, C]);
  });

  it('N == tracked changes nothing', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [heartbeat(1)], 10)).toEqual([]);
    expect(tracker.overCount).toBe(false);
  });

  it('N > tracked promotes pending handshakes unnamed, later renamed', () => {
    run(tracker, [join(A), character('X'), join(B)]);
    expect(run(tracker, [heartbeat(2)], 10)).toEqual([
      { kind: 'joined', steamId: B, name: null },
    ]);
    expect(tracker.overCount).toBe(false);
    expect(run(tracker, [character('Y')], 20)).toEqual([
      { kind: 'renamed', steamId: B, name: 'Y' },
    ]);
  });

  it('N > tracked with nothing pending keeps everyone and flags overCount', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [heartbeat(3)], 10)).toEqual([]);
    expect(tracker.overCount).toBe(true);
    expect(tracker.snapshot()).toEqual([{ steamId: A, name: 'X' }]);
    run(tracker, [heartbeat(1)], 20);
    expect(tracker.overCount).toBe(false);
  });
});

describe('ServerPresenceTracker — server lifecycle', () => {
  it.each(['server-stopping', 'server-ready'] as const)(
    '%s leaves everyone',
    (kind) => {
      run(tracker, [join(A), character('X'), join(B), character('Y')]);
      expect(run(tracker, [{ kind }], 10)).toEqual([
        { kind: 'left', steamId: A, name: 'X' },
        { kind: 'left', steamId: B, name: 'Y' },
      ]);
      expect(tracker.snapshot()).toEqual([]);
    },
  );
});

describe('ServerPresenceTracker — hydrate (restart path)', () => {
  it('restores the roster without emitting, then tracks it normally', () => {
    tracker.hydrate([
      { steamId: A, name: 'X' },
      { steamId: B, name: null },
    ]);
    expect(tracker.snapshot()).toEqual([
      { steamId: A, name: 'X' },
      { steamId: B, name: null },
    ]);
    expect(run(tracker, [leave(B)], 10)).toEqual([
      { kind: 'left', steamId: B, name: null },
    ]);
  });

  it('replaces prior state, and a hydrated name still marks a respawn', () => {
    run(tracker, [join(C), character('Z')]);
    tracker.hydrate([{ steamId: A, name: 'X' }]);
    expect(tracker.snapshot()).toEqual([{ steamId: A, name: 'X' }]);
    expect(run(tracker, [join(B), character('X'), character('Y')], 10)).toEqual(
      [{ kind: 'joined', steamId: B, name: 'Y' }],
    );
  });

  it('hydrated players are the longest-silent on a short heartbeat', () => {
    tracker.hydrate([{ steamId: A, name: 'X' }]);
    run(tracker, [join(B), character('Y')], 10);
    expect(run(tracker, [heartbeat(1)], 20)).toEqual([
      { kind: 'left', steamId: A, name: 'X' },
    ]);
  });
});

describe('ServerPresenceTracker — unnamed players after a restart (Codex r3)', () => {
  it('a hydrated unnamed player takes the next unpaired character name', () => {
    tracker.hydrate([
      { steamId: A, name: 'X' },
      { steamId: B, name: null },
    ]);
    expect(run(tracker, [character('Y')], 10)).toEqual([
      { kind: 'renamed', steamId: B, name: 'Y' },
    ]);
  });

  it('a restored unnamed player takes the next unpaired character name', () => {
    tracker.hydrate([{ steamId: B, name: null }]);
    run(tracker, [heartbeat(0)], 5);
    tracker.restore([{ steamId: B, name: null }]);
    expect(run(tracker, [character('Y')], 10)).toEqual([
      { kind: 'renamed', steamId: B, name: 'Y' },
    ]);
  });
});

describe('presenceDisplayName', () => {
  it('uses the character name, else the SteamID64 (ruling 3)', () => {
    expect(presenceDisplayName({ steamId: A, name: 'X' })).toBe('X');
    expect(presenceDisplayName({ steamId: A, name: null })).toBe(A);
  });
});

describe('hydrated owner ids (ROK-1822 r3)', () => {
  it("a stranger's same-named character pairs to their handshake, not to the hydrated player", () => {
    const t = new ServerPresenceTracker();
    t.hydrate([{ steamId: A, name: 'Bjorn', owner: '111' }]);
    t.apply(join(B), new Date());
    const changes = t.apply(
      { kind: 'character', name: 'Bjorn', zdoidZero: false, ownerId: '222' },
      new Date(),
    );

    expect(changes).toEqual([{ kind: 'joined', steamId: B, name: 'Bjorn' }]);
    expect([t.ownerOf(A), t.ownerOf(B)]).toEqual(['111', '222']);
  });
});
