import {
  netOwnerChanges,
  netPresenceChanges,
  ReplayWatermark,
  toPresentPlayers,
  toSinkPlayer,
} from './pelican-presence.helpers';
import { steamPlayer, type PlayerRef } from './presence-events';
import { rosterOf } from './server-presence.reader';

const xuid = (playerId: string): PlayerRef => ({ playerId, idKind: 'xuid' });

describe('ReplayWatermark', () => {
  it('admits newer events and rejects older ones', () => {
    const w = new ReplayWatermark();
    expect(w.admit('2026-10-15T10:00:00')).toBe(true);
    expect(w.admit('2026-10-15T10:00:05')).toBe(true);
    expect(w.admit('2026-10-15T10:00:01')).toBe(false);
    expect(w.admit(undefined)).toBe(true);
  });

  it('on a new pass skips exactly the events already admitted at the last second', () => {
    const w = new ReplayWatermark();
    w.admit('2026-10-15T10:00:05');
    w.admit('2026-10-15T10:00:05');
    w.beginPass();
    expect([
      w.admit('2026-10-15T10:00:04'),
      w.admit('2026-10-15T10:00:05'),
      w.admit('2026-10-15T10:00:05'),
      w.admit('2026-10-15T10:00:05'),
      w.admit('2026-10-15T10:00:06'),
    ]).toEqual([false, false, false, true, true]);
  });
});

describe('netPresenceChanges', () => {
  it('reports only the net joins, leaves and renames', () => {
    const before = [
      { ...steamPlayer('A'), name: 'Alice' },
      { ...steamPlayer('B'), name: null },
      { ...steamPlayer('C'), name: 'Cy' },
    ];
    const after = [
      { ...steamPlayer('A'), name: 'Alice' },
      { ...steamPlayer('B'), name: 'Bob' },
      { ...steamPlayer('D'), name: null },
    ];
    expect(netPresenceChanges(before, after)).toEqual([
      { kind: 'left', ...steamPlayer('C'), name: 'Cy' },
      { kind: 'renamed', ...steamPlayer('B'), name: 'Bob' },
      { kind: 'joined', ...steamPlayer('D'), name: null },
    ]);
  });

  it('maps a SteamID-only display label back to an unnamed player', () => {
    expect(
      toPresentPlayers([
        { steamId: 'A', displayName: 'A' },
        { steamId: 'B', displayName: 'Bob' },
      ]),
    ).toEqual([
      { ...steamPlayer('A'), name: null },
      { ...steamPlayer('B'), name: 'Bob' },
    ]);
  });
});

describe('netOwnerChanges (ROK-1822 r4)', () => {
  it('lists only same-named players whose owner alone changed', () => {
    const before = [
      { ...steamPlayer('A'), name: 'Alice', owner: '1' },
      { ...steamPlayer('B'), name: 'Bob', owner: '2' },
      { ...steamPlayer('C'), name: 'Cat' },
      { ...steamPlayer('D'), name: null },
    ];
    const after = [
      { ...steamPlayer('A'), name: 'Alice' },
      { ...steamPlayer('B'), name: 'Bob', owner: '2' },
      { ...steamPlayer('C'), name: 'Cat', owner: '3' },
      { ...steamPlayer('D'), name: null },
      { ...steamPlayer('E'), name: 'Eve', owner: '5' },
    ];
    const changes = [
      { kind: 'joined' as const, ...steamPlayer('E'), name: 'Eve' },
    ];
    expect(netOwnerChanges(before, after, changes)).toEqual([
      { ...steamPlayer('A'), name: 'Alice' },
      { ...steamPlayer('C'), name: 'Cat', owner: '3' },
    ]);
  });
});

describe('non-Steam players at the sink/reader boundary (ROK-2232)', () => {
  it('nets a SteamID and an XUID with the same digits as two players', () => {
    expect(
      netPresenceChanges(
        [{ ...steamPlayer('1'), name: 'Bjorn' }],
        [{ ...xuid('1'), name: 'Freya' }],
      ),
    ).toEqual([
      { kind: 'left', ...steamPlayer('1'), name: 'Bjorn' },
      { kind: 'joined', ...xuid('1'), name: 'Freya' },
    ]);
  });

  it('never hands an XUID to the sink as a SteamID', () => {
    expect(toSinkPlayer({ ...xuid('1'), name: 'Freya' }, '9')).toBeNull();
    expect(toSinkPlayer({ ...steamPlayer('1'), name: 'Bjorn' }, '9')).toEqual({
      steamId: '1',
      displayName: 'Bjorn',
      characterOwnerId: '9',
    });
  });

  it('never lists an XUID player as a SteamID on the roster', () => {
    const source = { pelicanServerId: 7, gameId: 42 };
    expect(
      rosterOf(source, [
        { ...xuid('1'), name: 'Freya' },
        { ...steamPlayer('2'), name: 'Bjorn' },
      ]),
    ).toEqual([{ ...source, steamId: '2', name: 'Bjorn' }]);
  });
});
