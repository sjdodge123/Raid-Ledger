import type { RawRosterRow } from './guild-roster.helpers';
import {
  frequencyOf,
  neededFor,
  toAttendanceRows,
  toComposition,
  toSchedule,
  type ScheduleSourceRow,
} from './guild-raids.helpers';

const d = (iso: string) => new Date(iso);

function occ(
  id: number,
  group: string,
  start: string,
  rule: unknown = { frequency: 'weekly' },
): ScheduleSourceRow {
  const startTime = d(start);
  return {
    id,
    title: `Raid ${group}`,
    startTime,
    endTime: new Date(startTime.getTime() + 3 * 3600_000),
    recurrenceGroupId: group,
    recurrenceRule: rule,
  };
}

function member(over: Partial<RawRosterRow>): RawRosterRow {
  return {
    memberId: 1,
    name: 'Char',
    class: null,
    level: null,
    rankIndex: 1,
    rankName: null,
    characterId: null,
    userId: null,
    role: null,
    roleOverride: null,
    isMain: null,
    ...over,
  };
}

describe('toSchedule', () => {
  it('keeps one row per series (its earliest occurrence), sorted, isNext on the first', () => {
    const out = toSchedule([
      occ(3, 'b', '2026-10-20T19:00:00Z', { frequency: 'biweekly' }),
      occ(2, 'a', '2026-10-23T19:00:00Z'),
      occ(1, 'a', '2026-10-16T19:00:00Z'),
      occ(4, 'b', '2026-11-03T19:00:00Z', { frequency: 'biweekly' }),
    ]);
    expect(out.map((r) => [r.eventId, r.isNext, r.frequency])).toEqual([
      [1, true, 'weekly'],
      [3, false, 'biweekly'],
    ]);
  });

  it('returns [] with no recurring occurrences', () => {
    expect(toSchedule([])).toEqual([]);
  });
});

describe('frequencyOf', () => {
  it('reads a known frequency and nulls anything else', () => {
    expect(frequencyOf({ frequency: 'monthly' })).toBe('monthly');
    expect(frequencyOf({ frequency: 'daily' })).toBeNull();
    expect(frequencyOf(null)).toBeNull();
  });
});

describe('neededFor', () => {
  it('sums the slotConfig playing slots (bench excluded)', () => {
    expect(
      neededFor({ type: 'mmo', tank: 2, healer: 4, dps: 14, bench: 5 }, 40),
    ).toBe(20);
  });

  it('falls back to maxAttendees, then null', () => {
    expect(neededFor(null, 12)).toBe(12);
    expect(neededFor({ type: 'generic' }, null)).toBeNull();
  });
});

describe('toComposition', () => {
  const event = {
    id: 9,
    title: 'MC',
    startTime: d('2026-10-16T19:00:00Z'),
    slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
  };

  it('reports filled vs needed per role and passes the bench through', () => {
    const benched = [{ characterId: null, name: 'Benchy' }];
    const out = toComposition(event, new Map([['tank', 1], ['dps', 3]]), benched);
    expect(out?.roles).toEqual([
      { role: 'tank', filled: 1, needed: 2 },
      { role: 'healer', filled: 0, needed: 4 },
      { role: 'dps', filled: 3, needed: 14 },
    ]);
    expect(out?.benched).toEqual(benched);
    expect(out?.event.startTime).toBe('2026-10-16T19:00:00.000Z');
  });

  it('is null when the event is not MMO-slotted', () => {
    const generic = { ...event, slotConfig: { type: 'generic', player: 10 } };
    expect(toComposition(generic, new Map(), [])).toBeNull();
  });
});

describe('toAttendanceRows', () => {
  const members = [
    member({ memberId: 1, name: 'Zed', userId: 10, characterId: 'c-10' }),
    member({ memberId: 2, name: 'Alt', userId: 11, characterId: 'c-11a' }),
    member({ memberId: 3, name: 'Main', userId: 11, characterId: 'c-11', isMain: true }),
    member({ memberId: 4, name: 'Amy', userId: 12, characterId: 'c-12' }),
    member({ memberId: 5, name: 'Unlinked', userId: null }),
  ];

  it('sorts by attended desc then name, one row per linked member (main char)', () => {
    const out = toAttendanceRows(members, new Map([[10, 2], [11, 3], [99, 4]]), 4);
    expect(out.map((r) => [r.userId, r.name, r.attended, r.of])).toEqual([
      [11, 'Main', 3, 4],
      [10, 'Zed', 2, 4],
      [12, 'Amy', 0, 4],
    ]);
  });

  it('is empty when nothing was recorded (of = 0)', () => {
    expect(toAttendanceRows(members, new Map([[10, 1]]), 0)).toEqual([]);
  });
});
