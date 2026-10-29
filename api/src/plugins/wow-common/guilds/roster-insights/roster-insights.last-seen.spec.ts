/**
 * ROK-1916 (W9 "Last seen") — pure presence aggregation (spec D3/D5).
 */
import { computeLastSeen, type LastSeenRow } from './roster-insights.last-seen';

function row(
  name: string,
  onlineAtExport: boolean | null,
  lastOnlineDays: number | null = null,
  rankIndex: number | null = 2,
): LastSeenRow {
  return { name, characterId: null, rankIndex, onlineAtExport, lastOnlineDays };
}

describe('computeLastSeen (ROK-1916)', () => {
  it('reports zero for a roster no export ever reported presence on', () => {
    expect(computeLastSeen([row('a', null), row('b', null)])).toEqual({
      reported: 0,
      onlineCount: 0,
      online: [],
      away: [],
    });
  });

  it('counts reported rows; online in roster order (rank, then name)', () => {
    const out = computeLastSeen([
      row('zed', true, null, 1),
      row('bob', true, null, 3),
      row('Amy', true, null, 3),
      row('unreported', null),
      row('off', false, 5),
    ]);
    expect(out.reported).toBe(4);
    expect(out.onlineCount).toBe(3);
    expect(out.online.map((o) => o.name)).toEqual(['zed', 'Amy', 'bob']);
    expect(out.online[0]).toEqual({ name: 'zed', characterId: null });
  });

  it('D3: an online row is online whatever its day count', () => {
    const out = computeLastSeen([row('a', true, 40)]);
    expect(out.online.map((o) => o.name)).toEqual(['a']);
    expect(out.away).toEqual([]);
  });

  it('away = offline rows with days, most days first, ties by name', () => {
    const out = computeLastSeen([
      row('b', false, 2),
      row('c', false, 40),
      row('a', false, 2),
      row('nodays', false, null),
      row('today', false, 0),
    ]);
    expect(out.away).toEqual([
      { name: 'c', characterId: null, days: 40 },
      { name: 'a', characterId: null, days: 2 },
      { name: 'b', characterId: null, days: 2 },
      { name: 'today', characterId: null, days: 0 },
    ]);
    expect(out.reported).toBe(5);
  });

  it('caps online at 25 and away at 10 but counts every online row', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => row(`on${i}`, true)),
      ...Array.from({ length: 12 }, (_, i) => row(`off${i}`, false, i)),
    ];
    const out = computeLastSeen(rows);
    expect(out.onlineCount).toBe(30);
    expect(out.online).toHaveLength(25);
    expect(out.away).toHaveLength(10);
    expect(out.away[0]).toEqual({ name: 'off11', characterId: null, days: 11 });
    expect(out.reported).toBe(42);
  });
});
