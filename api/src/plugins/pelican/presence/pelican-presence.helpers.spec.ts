import {
  netOwnerChanges,
  netPresenceChanges,
  ReplayWatermark,
  toPresentPlayers,
} from './pelican-presence.helpers';

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
      { steamId: 'A', name: 'Alice' },
      { steamId: 'B', name: null },
      { steamId: 'C', name: 'Cy' },
    ];
    const after = [
      { steamId: 'A', name: 'Alice' },
      { steamId: 'B', name: 'Bob' },
      { steamId: 'D', name: null },
    ];
    expect(netPresenceChanges(before, after)).toEqual([
      { kind: 'left', steamId: 'C', name: 'Cy' },
      { kind: 'renamed', steamId: 'B', name: 'Bob' },
      { kind: 'joined', steamId: 'D', name: null },
    ]);
  });

  it('maps a SteamID-only display label back to an unnamed player', () => {
    expect(
      toPresentPlayers([
        { steamId: 'A', displayName: 'A' },
        { steamId: 'B', displayName: 'Bob' },
      ]),
    ).toEqual([
      { steamId: 'A', name: null },
      { steamId: 'B', name: 'Bob' },
    ]);
  });
});

describe('netOwnerChanges (ROK-1822 r4)', () => {
  it('lists only same-named players whose owner alone changed', () => {
    const before = [
      { steamId: 'A', name: 'Alice', owner: '1' },
      { steamId: 'B', name: 'Bob', owner: '2' },
      { steamId: 'C', name: 'Cat' },
      { steamId: 'D', name: null },
    ];
    const after = [
      { steamId: 'A', name: 'Alice' },
      { steamId: 'B', name: 'Bob', owner: '2' },
      { steamId: 'C', name: 'Cat', owner: '3' },
      { steamId: 'D', name: null },
      { steamId: 'E', name: 'Eve', owner: '5' },
    ];
    const changes = [{ kind: 'joined' as const, steamId: 'E', name: 'Eve' }];
    expect(netOwnerChanges(before, after, changes)).toEqual([
      { steamId: 'A', name: 'Alice' },
      { steamId: 'C', name: 'Cat', owner: '3' },
    ]);
  });
});
