import {
  steamPlayer,
  type GamePresenceEvent,
  type PlayerRef,
} from './presence-events';
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
  ...steamPlayer(steamId),
});
const leave = (steamId: string): GamePresenceEvent => ({
  kind: 'leave',
  ...steamPlayer(steamId),
});
const authFailed = (steamId: string): GamePresenceEvent => ({
  kind: 'auth-failed',
  ...steamPlayer(steamId),
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
      { kind: 'joined', ...steamPlayer(A), name: 'Ragnhild' },
    ]);
    expect(tracker.snapshot()).toEqual([
      { ...steamPlayer(A), name: 'Ragnhild' },
    ]);
  });

  it('pairs character lines to handshakes FIFO', () => {
    const changes = run(tracker, [
      join(A),
      join(B),
      character('X'),
      character('Y'),
    ]);
    expect(changes).toEqual([
      { kind: 'joined', ...steamPlayer(A), name: 'X' },
      { kind: 'joined', ...steamPlayer(B), name: 'Y' },
    ]);
  });

  it('a repeat handshake from a present player changes nothing', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [join(A), character('Y')], 10)).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ ...steamPlayer(A), name: 'X' }]);
  });
});

describe('ServerPresenceTracker — death and respawn', () => {
  it('a 0:0 death of a present player does not leave', () => {
    run(tracker, [join(A), character('Bjorn')]);
    expect(
      run(tracker, [character('Bjorn', true), character('Bjorn')], 10),
    ).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ ...steamPlayer(A), name: 'Bjorn' }]);
  });

  it('a respawn does not consume a newer pending handshake', () => {
    run(tracker, [join(A), character('Bjorn'), join(B)]);
    expect(run(tracker, [character('Bjorn'), character('Freya')], 10)).toEqual([
      { kind: 'joined', ...steamPlayer(B), name: 'Freya' },
    ]);
  });

  it('playerOfCharacter names the paired player, null for an unknown name (ROK-1930)', () => {
    run(tracker, [join(A), character('Bjorn'), join(B), character('Freya')]);
    expect(tracker.playerOfCharacter('Bjorn')).toEqual(steamPlayer(A));
    expect(tracker.playerOfCharacter('Freya')).toEqual(steamPlayer(B));
    expect(tracker.playerOfCharacter('Ghost')).toBeNull();
  });

  it('playerOfCharacter is null for a still-pending handshake (ROK-1930)', () => {
    run(tracker, [join(A)]);
    expect(tracker.playerOfCharacter('Bjorn')).toBeNull();
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
      { kind: 'joined', ...steamPlayer(B), name: 'Bjorn' },
    ]);
    expect(tracker.snapshot()).toEqual([
      { ...steamPlayer(A), name: 'Bjorn' },
      { ...steamPlayer(B), name: 'Bjorn' },
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
      { kind: 'joined', ...steamPlayer(C), name: 'Freya' },
    ]);
  });

  it('a hydrated player adopts the owner id of their first respawn line', () => {
    tracker.hydrate([{ ...steamPlayer(A), name: 'Bjorn' }]);
    run(tracker, [join(B)]);
    expect(run(tracker, [characterOf('Bjorn', '111')], 10)).toEqual([]);
    expect(run(tracker, [characterOf('Bjorn', '222')], 20)).toEqual([
      { kind: 'joined', ...steamPlayer(B), name: 'Bjorn' },
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
      { kind: 'joined', ...steamPlayer(B), name: 'Freya' },
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
    ).toEqual([{ kind: 'joined', ...steamPlayer(A), name: 'X' }]);
  });
});

describe('ServerPresenceTracker — leave', () => {
  it('removes a present player and reports their name', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [leave(A)], 10)).toEqual([
      { kind: 'left', ...steamPlayer(A), name: 'X' },
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
      { kind: 'left', ...steamPlayer(A), name: 'X' },
      { kind: 'left', ...steamPlayer(B), name: 'Y' },
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
      { kind: 'left', ...steamPlayer(B), name: 'Y' },
    ]);
    expect(tracker.snapshot().map((p) => p.playerId)).toEqual([A, C]);
  });

  it('N == tracked changes nothing', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [heartbeat(1)], 10)).toEqual([]);
    expect(tracker.overCount).toBe(false);
  });

  it('N > tracked promotes pending handshakes unnamed, later renamed', () => {
    run(tracker, [join(A), character('X'), join(B)]);
    expect(run(tracker, [heartbeat(2)], 10)).toEqual([
      { kind: 'joined', ...steamPlayer(B), name: null },
    ]);
    expect(tracker.overCount).toBe(false);
    expect(run(tracker, [character('Y')], 20)).toEqual([
      { kind: 'renamed', ...steamPlayer(B), name: 'Y' },
    ]);
  });

  it('N > tracked with nothing pending keeps everyone and flags overCount', () => {
    run(tracker, [join(A), character('X')]);
    expect(run(tracker, [heartbeat(3)], 10)).toEqual([]);
    expect(tracker.overCount).toBe(true);
    expect(tracker.snapshot()).toEqual([{ ...steamPlayer(A), name: 'X' }]);
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
        { kind: 'left', ...steamPlayer(A), name: 'X' },
        { kind: 'left', ...steamPlayer(B), name: 'Y' },
      ]);
      expect(tracker.snapshot()).toEqual([]);
    },
  );
});

describe('ServerPresenceTracker — hydrate (restart path)', () => {
  it('restores the roster without emitting, then tracks it normally', () => {
    tracker.hydrate([
      { ...steamPlayer(A), name: 'X' },
      { ...steamPlayer(B), name: null },
    ]);
    expect(tracker.snapshot()).toEqual([
      { ...steamPlayer(A), name: 'X' },
      { ...steamPlayer(B), name: null },
    ]);
    expect(run(tracker, [leave(B)], 10)).toEqual([
      { kind: 'left', ...steamPlayer(B), name: null },
    ]);
  });

  it('replaces prior state, and a hydrated name still marks a respawn', () => {
    run(tracker, [join(C), character('Z')]);
    tracker.hydrate([{ ...steamPlayer(A), name: 'X' }]);
    expect(tracker.snapshot()).toEqual([{ ...steamPlayer(A), name: 'X' }]);
    expect(run(tracker, [join(B), character('X'), character('Y')], 10)).toEqual(
      [{ kind: 'joined', ...steamPlayer(B), name: 'Y' }],
    );
  });

  it('hydrated players are the longest-silent on a short heartbeat', () => {
    tracker.hydrate([{ ...steamPlayer(A), name: 'X' }]);
    run(tracker, [join(B), character('Y')], 10);
    expect(run(tracker, [heartbeat(1)], 20)).toEqual([
      { kind: 'left', ...steamPlayer(A), name: 'X' },
    ]);
  });
});

describe('ServerPresenceTracker — unnamed players after a restart (Codex r3)', () => {
  it('a hydrated unnamed player takes the next unpaired character name', () => {
    tracker.hydrate([
      { ...steamPlayer(A), name: 'X' },
      { ...steamPlayer(B), name: null },
    ]);
    expect(run(tracker, [character('Y')], 10)).toEqual([
      { kind: 'renamed', ...steamPlayer(B), name: 'Y' },
    ]);
  });

  it('a restored unnamed player takes the next unpaired character name', () => {
    tracker.hydrate([{ ...steamPlayer(B), name: null }]);
    run(tracker, [heartbeat(0)], 5);
    tracker.restore([{ ...steamPlayer(B), name: null }]);
    expect(run(tracker, [character('Y')], 10)).toEqual([
      { kind: 'renamed', ...steamPlayer(B), name: 'Y' },
    ]);
  });
});

describe('presenceDisplayName', () => {
  it('uses the character name, else the SteamID64 (ruling 3)', () => {
    expect(presenceDisplayName({ ...steamPlayer(A), name: 'X' })).toBe('X');
    expect(presenceDisplayName({ ...steamPlayer(A), name: null })).toBe(A);
  });
});

describe('hydrated owner ids (ROK-1822 r3)', () => {
  it("a stranger's same-named character pairs to their handshake, not to the hydrated player", () => {
    const t = new ServerPresenceTracker();
    t.hydrate([{ ...steamPlayer(A), name: 'Bjorn', owner: '111' }]);
    t.apply(join(B), new Date());
    const changes = t.apply(
      { kind: 'character', name: 'Bjorn', zdoidZero: false, ownerId: '222' },
      new Date(),
    );

    expect(changes).toEqual([
      { kind: 'joined', ...steamPlayer(B), name: 'Bjorn' },
    ]);
    expect([t.ownerOf(steamPlayer(A)), t.ownerOf(steamPlayer(B))]).toEqual([
      '111',
      '222',
    ]);
  });
});

describe('owner-carrying snapshot for cold-replay restore (ROK-1822 r4)', () => {
  it('snapshotWithOwners → restore keeps a hydrated owner id', () => {
    const t = new ServerPresenceTracker();
    t.hydrate([{ ...steamPlayer(A), name: 'Bjorn', owner: '111' }]);
    const before = t.snapshotWithOwners();
    t.apply(leave(A), new Date(1_000));
    t.restore(before);
    expect(t.ownerOf(steamPlayer(A))).toBe('111');
    // The plain roster snapshot stays name-only.
    expect(t.snapshot()).toEqual([{ ...steamPlayer(A), name: 'Bjorn' }]);
  });
});

describe('over-long character names vs the clamped stored roster (varchar(255))', () => {
  const LOG_NAME = 'L'.repeat(300);
  const STORED_NAME = 'L'.repeat(255);

  it("a player rehydrated under the clamped name matches their full-length line and does not take another player's handshake", () => {
    tracker.hydrate([{ ...steamPlayer(A), name: STORED_NAME, owner: '111' }]);
    expect(run(tracker, [join(B), characterOf(LOG_NAME, '111')], 10)).toEqual(
      [],
    );
    expect(tracker.snapshot()).toEqual([
      { ...steamPlayer(A), name: STORED_NAME },
    ]);
    // B's handshake is still pending for B's own character line.
    expect(run(tracker, [characterOf('Y', '222')], 20)).toEqual([
      { kind: 'joined', ...steamPlayer(B), name: 'Y' },
    ]);
  });

  it('a death line with the full-length name resolves to the rehydrated player', () => {
    tracker.hydrate([{ ...steamPlayer(A), name: STORED_NAME }]);
    expect(tracker.playerOfCharacter(LOG_NAME)).toEqual(steamPlayer(A));
    expect(run(tracker, [join(B), character(LOG_NAME)], 10)).toEqual([]);
  });

  it('a live over-long name is tracked in its clamped form', () => {
    expect(run(tracker, [join(A), characterOf(LOG_NAME, '111')])).toEqual([
      { kind: 'joined', ...steamPlayer(A), name: STORED_NAME },
    ]);
  });
});

describe('ServerPresenceTracker — platform id kinds (ROK-2232)', () => {
  const xuid = (playerId: string): PlayerRef => ({ playerId, idKind: 'xuid' });
  const joinAs = (ref: PlayerRef): GamePresenceEvent => ({
    kind: 'join',
    ...ref,
  });
  const leaveAs = (ref: PlayerRef): GamePresenceEvent => ({
    kind: 'leave',
    ...ref,
  });

  it('keeps a SteamID and an XUID with the same digits as two players', () => {
    expect(
      run(tracker, [
        join(A),
        character('Bjorn'),
        joinAs(xuid(A)),
        character('Freya'),
      ]),
    ).toEqual([
      { kind: 'joined', ...steamPlayer(A), name: 'Bjorn' },
      { kind: 'joined', ...xuid(A), name: 'Freya' },
    ]);
    expect(run(tracker, [leaveAs(xuid(A))], 10)).toEqual([
      { kind: 'left', ...xuid(A), name: 'Freya' },
    ]);
    expect(tracker.snapshot()).toEqual([{ ...steamPlayer(A), name: 'Bjorn' }]);
  });

  it('a Steam leave never removes the same-digit XUID player', () => {
    run(tracker, [joinAs(xuid(A)), character('Freya')]);
    expect(run(tracker, [leave(A)], 10)).toEqual([]);
    expect(tracker.snapshot()).toEqual([{ ...xuid(A), name: 'Freya' }]);
  });

  it('labels an unnamed XUID player by the id, and resolves a death to its ref', () => {
    tracker.hydrate([{ ...xuid('2535400000000001'), name: null }]);
    const [player] = tracker.snapshot();
    expect(player && presenceDisplayName(player)).toBe('2535400000000001');
    tracker.hydrate([{ ...xuid(A), name: 'Freya', owner: '9' }]);
    expect(tracker.playerOfCharacter('Freya')).toEqual(xuid(A));
    expect(tracker.ownerOf(xuid(A))).toBe('9');
    expect(tracker.ownerOf(steamPlayer(A))).toBeNull();
  });
});
