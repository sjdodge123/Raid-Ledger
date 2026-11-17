/**
 * ROK-2212 — unit U1–U10 (incl. U3b/U3c/U5b) for the pure Suggested groups
 * maths: pool, candidates, ranking, top pick and the identity keys.
 */
import type {
  CharacterRole,
  SuggestedGroupDto,
  SuggestedGroupRole,
} from '@raid-ledger/contract';
import type { ResolvedWowFacts } from '../../facts/wow-fact.types';
import { levelOf } from '../roster-insights/roster-insights.levels';
import type { InsightRow } from '../roster-insights/roster-insights.types';
import {
  buildCandidates,
  eligiblePool,
  pickTop,
  rankGroups,
  type PoolEntry,
} from './suggested-groups.helpers';
import { memberKey, playerKey, rolesOf } from './suggested-groups.roles';

const RFK = {
  id: 491,
  name: 'Razorfen Kraul',
  minimumLevel: 29,
  maximumLevel: 38,
};
const SM = {
  id: 500,
  name: 'Scarlet Monastery',
  minimumLevel: 30,
  maximumLevel: 45,
};

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface RowSpec {
  name: string;
  role: CharacterRole | null;
  level?: number | null;
  /** Claimed character n (uuid(n)); omitted = unclaimed. */
  char?: number;
  memberId?: number;
  userId?: number;
}

let nextMember = 1000;
function row(s: RowSpec): InsightRow {
  const fact = <T>(value: T) => ({
    value,
    source: 'blizzard' as const,
    asOf: null,
  });
  const level = s.level === undefined ? 30 : s.level;
  const facts: ResolvedWowFacts = {
    level: level === null ? null : fact(level),
    class: fact('Warrior'),
    role: s.role === null ? null : fact(s.role),
    race: null,
    ilvl: null,
    gear: null,
    professions: null,
    quests: null,
    lockouts: null,
    lastOnline: null,
    enchantsReported: null,
  };
  return {
    name: s.name,
    characterId: s.char === undefined ? null : uuid(s.char),
    memberId: s.memberId ?? (nextMember += 1),
    userId: s.userId ?? null,
    isMain: true,
    rankIndex: null,
    onlineAtExport: null,
    lastOnlineDays: null,
    facts,
  };
}

/** A claimed character owned by user `u` (character id = u * 10 + alt). */
const claimed = (
  name: string,
  role: CharacterRole,
  u: number,
  level = 30,
  alt = 0,
) => row({ name, role, level, char: u * 10 + alt, userId: u });

const poolOf = (
  rows: InsightRow[],
  roles: (r: InsightRow) => SuggestedGroupRole[] = rolesOf,
): PoolEntry[] => eligiblePool(rows, levelOf, roles).entries;
const keysOf = (g: SuggestedGroupDto) => g.members.map((m) => m.key);
const namesOf = (g: SuggestedGroupDto) => g.members.map((m) => m.name);
const players = (g: SuggestedGroupDto) =>
  g.members.map((m) => (m.userId !== null ? `u${m.userId}` : m.key));

const base = () => [
  claimed('Tank', 'tank', 1),
  claimed('Heal', 'healer', 2),
  claimed('DpsA', 'dps', 3),
  claimed('DpsB', 'dps', 4),
  claimed('DpsC', 'dps', 5),
];

describe('buildCandidates — template and level fit', () => {
  it('U1: fills exactly 1 tank, 1 healer, 3 dps in that order', () => {
    const [g, ...rest] = buildCandidates(poolOf(base()), RFK);
    expect(rest).toEqual([]);
    expect(g?.members.map((m) => m.role)).toEqual([
      'tank',
      'healer',
      'dps',
      'dps',
      'dps',
    ]);
    expect(g?.instance).toEqual(RFK);
    expect(buildCandidates(poolOf(base().slice(1)), RFK)).toEqual([]);
  });

  it('L6: picks the 3 dps closest in level to the tank/healer mean', () => {
    const rows = [...base(), claimed('Far', 'dps', 6, 37)];
    const g = must(buildCandidates(poolOf(rows), RFK)[0], 'group');
    expect(namesOf(g)).not.toContain('Far');
    expect(g.levelSpread).toBe(0);
  });

  it('U2: the range is inclusive at min and max and excludes min−1 / max+1', () => {
    const edge = [
      claimed('T', 'tank', 1, 29),
      claimed('H', 'healer', 2, 38),
      ...base().slice(2),
    ];
    expect(buildCandidates(poolOf(edge), RFK)).toHaveLength(1);
    const below = [claimed('T', 'tank', 1, 28), ...base().slice(1)];
    expect(buildCandidates(poolOf(below), RFK)).toEqual([]);
    const above = [
      must(base()[0], 'tank'),
      claimed('H', 'healer', 2, 39),
      ...base().slice(2),
    ];
    expect(buildCandidates(poolOf(above), RFK)).toEqual([]);
  });
});

describe('buildCandidates — one character per player', () => {
  it('U3: an alt of a picked dps never fills a second slot', () => {
    const rows = [
      ...base().slice(0, 3),
      claimed('DpsA-alt', 'dps', 3, 30, 1),
      claimed('DpsB', 'dps', 4),
    ];
    expect(buildCandidates(poolOf(rows), RFK).map(namesOf)).toEqual([]);
    const withThird = [...rows, claimed('DpsC', 'dps', 5)];
    const groups = buildCandidates(poolOf(withThird), RFK);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(new Set(players(g)).size).toBe(5);
  });

  it('U3: a user owning the tank and a healer never fills both', () => {
    const rows = [...base(), claimed('TankAltHeal', 'healer', 1, 30, 1)];
    const groups = buildCandidates(poolOf(rows), RFK);
    expect(groups.map(namesOf)).toEqual([
      ['Tank', 'Heal', 'DpsA', 'DpsB', 'DpsC'],
    ]);
  });

  it('U3b: unclaimed rows are their own players, never merged by name', () => {
    const rows = [
      ...base().slice(0, 2),
      row({ name: 'Bob', role: 'dps', memberId: 1 }),
      row({ name: 'Bob', role: 'dps', memberId: 2 }),
      claimed('Bob', 'dps', 9),
    ];
    const groups = buildCandidates(poolOf(rows), RFK);
    expect(groups.map((g) => keysOf(g).slice(2).sort())).toEqual([
      [uuid(90), 'm1', 'm2'],
    ]);
  });

  it('U3c: unclaimed rows enter the pool with characterId null and key m<memberId>', () => {
    const { entries, counts } = eligiblePool(
      [row({ name: 'Jaina', role: 'healer', level: 31, memberId: 42 })],
      levelOf,
      rolesOf,
    );
    expect(entries.map((e) => e.member)).toEqual([
      {
        key: 'm42',
        characterId: null,
        memberId: 42,
        userId: null,
        name: 'Jaina',
        class: 'Warrior',
        level: 31,
      },
    ]);
    expect(entries[0]?.player).toBe('m42');
    expect(counts).toMatchObject({ healer: 1, unclaimed: 1 });
  });
});

describe('eligiblePool and roles', () => {
  it('U4: unknown role / unknown level are excluded and counted', () => {
    const rows = [
      ...base(),
      row({ name: 'NoRole', role: null }),
      row({ name: 'NoLevel', role: 'tank', level: null }),
    ];
    const { entries, counts } = eligiblePool(rows, levelOf, rolesOf);
    expect(entries.map((e) => e.member.name)).toEqual([
      'DpsA',
      'DpsB',
      'DpsC',
      'Heal',
      'Tank',
    ]);
    expect(counts).toEqual({
      tank: 1,
      healer: 1,
      dps: 3,
      unclaimed: 0,
      skippedNoRole: 1,
      skippedNoLevel: 1,
    });
  });

  it('U5: a tank never fills a dps slot', () => {
    const rows = [...base().slice(0, 4), claimed('Tank2', 'tank', 6)];
    expect(buildCandidates(poolOf(rows), RFK)).toEqual([]);
    const groups = buildCandidates(
      poolOf([...rows, claimed('DpsC', 'dps', 5)]),
      RFK,
    );
    for (const g of groups)
      expect(
        g.members.filter((m) => m.name === 'Tank2').map((m) => m.role),
      ).not.toContain('dps');
  });

  it('U5b: two listed roles make a character a candidate for both, one slot per group', () => {
    const dual = (r: InsightRow): SuggestedGroupRole[] =>
      r.name === 'Dual' ? ['tank', 'dps'] : rolesOf(r);
    const rows = [
      claimed('Dual', 'tank', 7),
      ...base().slice(0, 4),
      claimed('DpsC', 'dps', 5, 35),
    ];
    const { counts } = eligiblePool(rows, levelOf, dual);
    expect(counts).toMatchObject({ tank: 2, dps: 4 });
    const groups = buildCandidates(poolOf(rows, dual), RFK);
    const dualRoles = groups.map((g) =>
      g.members.filter((m) => m.name === 'Dual').map((m) => m.role),
    );
    expect(dualRoles).toEqual(expect.arrayContaining([['tank'], ['dps']]));
    for (const r of dualRoles) expect(r.length).toBeLessThanOrEqual(1);
  });

  it('dedupes the same five characters in swapped slots', () => {
    const dual = (r: InsightRow): SuggestedGroupRole[] =>
      r.name.startsWith('Flex') ? ['tank', 'dps'] : rolesOf(r);
    const rows = [
      claimed('FlexX', 'tank', 1),
      claimed('FlexY', 'tank', 2),
      claimed('H', 'healer', 3),
      claimed('D1', 'dps', 4),
      claimed('D2', 'dps', 5),
    ];
    expect(buildCandidates(poolOf(rows, dual), RFK)).toHaveLength(1);
  });

  it('U10: playerKey is u<userId> when owned, else the member key', () => {
    const owned = claimed('A', 'dps', 4);
    const unowned = row({ name: 'B', role: 'dps', memberId: 8 });
    expect([playerKey(owned), memberKey(owned)]).toEqual(['u4', uuid(40)]);
    expect([playerKey(unowned), memberKey(unowned)]).toEqual(['m8', 'm8']);
    expect(rolesOf(row({ name: 'C', role: null }))).toEqual([]);
    expect(rolesOf(owned)).toEqual(['dps']);
  });
});

const group = (
  instance: typeof RFK,
  levelSpread: number,
  sharedQuests: number | null,
  name = 'A',
): SuggestedGroupDto => ({
  instance,
  members: base().map((r) => ({
    ...must(poolOf([r])[0], 'entry').member,
    name,
    role: 'dps' as const,
  })),
  levelSpread,
  sharedQuests,
});

describe('rankGroups / pickTop / cap', () => {
  it('U6: level spread asc, then shared quests desc (null last)', () => {
    const ranked = rankGroups([
      group(RFK, 2, 5),
      group(RFK, 1, null),
      group(RFK, 1, 0),
      group(RFK, 1, 3),
    ]);
    expect(ranked.map((g) => [g.levelSpread, g.sharedQuests])).toEqual([
      [1, 3],
      [1, 0],
      [1, null],
      [2, 5],
    ]);
  });

  it('U7: ties are broken deterministically (min level, then names), whatever the input order', () => {
    const input = [
      group(SM, 1, 0, 'A'),
      group(RFK, 1, 0, 'B'),
      group(RFK, 1, 0, 'A'),
    ];
    const expected = [
      [RFK.id, 'A'],
      [RFK.id, 'B'],
      [SM.id, 'A'],
    ];
    expect(
      rankGroups(input).map((g) => [g.instance.id, g.members[0]?.name]),
    ).toEqual(expected);
    expect(
      rankGroups([...input].reverse()).map((g) => [
        g.instance.id,
        g.members[0]?.name,
      ]),
    ).toEqual(expected);
    const rows = [
      ...base(),
      claimed('Heal2', 'healer', 6),
      claimed('DpsD', 'dps', 8),
    ];
    expect(buildCandidates(poolOf([...rows].reverse()), RFK)).toEqual(
      buildCandidates(poolOf(rows), RFK),
    );
  });

  it('U8: pickTop takes the best group of each of the 3 best distinct dungeons', () => {
    const d = (id: number, min: number) => ({
      id,
      name: `D${id}`,
      minimumLevel: min,
      maximumLevel: 60,
    });
    const groups = [
      group(d(1, 10), 3, 0),
      group(d(1, 10), 0, 0),
      group(d(2, 20), 1, 0),
      group(d(3, 30), 2, 0),
      group(d(4, 40), 4, 0),
    ];
    expect(pickTop(groups).map((g) => [g.instance.id, g.levelSpread])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it('U9: at most 10 lineups per dungeon (cap overridable)', () => {
    const rows = [1, 2, 3, 4].flatMap((i) => [
      claimed(`T${i}`, 'tank', i),
      claimed(`H${i}`, 'healer', 10 + i),
    ]);
    const many = [
      ...rows,
      ...[1, 2, 3, 4, 5, 6].map((i) => claimed(`D${i}`, 'dps', 20 + i, 29 + i)),
    ];
    expect(buildCandidates(poolOf(many), RFK)).toHaveLength(10);
    expect(buildCandidates(poolOf(many), RFK, 4)).toHaveLength(4);
  });
});
