import type { CharacterRole, HubFactSource } from '@raid-ledger/contract';
import type { ResolvedWowFacts } from '../../facts/wow-fact.types';
import {
  computeFreshness,
  computeProfessions,
  computeRoles,
  mainsOnly,
} from './roster-insights.helpers';
import {
  LOWEST_DUNGEON_LEVEL,
  computeClasses,
  computeLevels,
  median,
} from './roster-insights.levels';
import type { InsightRow } from './roster-insights.types';

const AS_OF = new Date('2026-11-01T00:00:00.000Z');
const EMPTY: ResolvedWowFacts = {
  level: null,
  class: null,
  race: null,
  role: null,
  ilvl: null,
  gear: null,
  professions: null,
  quests: null,
  lockouts: null,
  lastOnline: null,
  enchantsReported: null,
};

interface RowOpts {
  level?: number;
  cls?: string;
  role?: CharacterRole;
  userId?: number;
  isMain?: boolean;
  rankIndex?: number;
  source?: HubFactSource;
  asOf?: Date | null;
}

let seq = 0;
function row(name: string, o: RowOpts = {}): InsightRow {
  seq += 1;
  const src = o.source ?? 'roster';
  const asOf = o.asOf === undefined ? AS_OF : o.asOf;
  const linked = o.userId !== undefined;
  return {
    name,
    characterId: linked
      ? `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
      : null,
    userId: o.userId ?? null,
    isMain: o.isMain ?? false,
    rankIndex: o.rankIndex ?? null,
    onlineAtExport: null,
    lastOnlineDays: null,
    facts: {
      ...EMPTY,
      level:
        o.level === undefined ? null : { value: o.level, source: src, asOf },
      class: { value: o.cls ?? 'Mage', source: src, asOf },
      role: o.role ? { value: o.role, source: 'manual', asOf: null } : null,
    },
  };
}

describe('roster-insights levels', () => {
  it('median handles odd, even and empty lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([])).toBeNull();
  });

  it('buckets 1-9 … 50-59 then 60, with max, median and atCap', () => {
    const got = computeLevels([
      row('a', { level: 5 }),
      row('b', { level: 59 }),
      row('c', { level: 60 }),
      row('d', { level: 60 }),
      row('e'),
    ]);
    expect(got.buckets.map((b) => [b.from, b.to])).toEqual([
      [1, 9],
      [10, 19],
      [20, 29],
      [30, 39],
      [40, 49],
      [50, 59],
      [60, 60],
    ]);
    expect(got.buckets.map((b) => b.count)).toEqual([1, 0, 0, 0, 0, 1, 2]);
    expect(got).toMatchObject({ max: 60, median: 59.5, atCap: 2 });
  });

  it('an empty roster has null max/median and zero at cap', () => {
    expect(computeLevels([])).toMatchObject({
      max: null,
      median: null,
      atCap: 0,
    });
  });
});

describe('roster-insights classes', () => {
  it('counts EVERY row, linked or not, biggest class first', () => {
    const got = computeClasses([
      row('a', { cls: 'Priest' }),
      row('b', { cls: 'Mage', userId: 1 }),
      row('c', { cls: 'Mage', userId: 1 }),
    ]);
    expect(got.map((c) => [c.class, c.count])).toEqual([
      ['Mage', 2],
      ['Priest', 1],
    ]);
    expect(got[0]?.members.map((m) => m.name)).toEqual(['b', 'c']);
    expect(got[1]?.members[0]).toEqual({
      name: 'a',
      characterId: null,
      level: null,
    });
  });
});

describe('roster-insights roles', () => {
  it('counts one role per linked user (main wins) and skips unlinked rows', () => {
    const got = computeRoles([
      row('alt', { userId: 1, level: 60, role: 'dps' }),
      row('main', { userId: 1, level: 60, role: 'tank', isMain: true }),
      row('pug', { level: 60, role: 'healer' }),
    ]);
    expect(got.raid).toEqual({ tank: 1, healer: 0, dps: 0, unknown: 0 });
  });

  it('splits dungeon-eligible (≥ lowest instance min) from raid-eligible (cap)', () => {
    const got = computeRoles([
      row('low', { userId: 1, level: LOWEST_DUNGEON_LEVEL - 1, role: 'tank' }),
      row('mid', { userId: 2, level: LOWEST_DUNGEON_LEVEL, role: 'healer' }),
      row('cap', { userId: 3, level: 60 }),
    ]);
    expect(got.dungeon).toEqual({ tank: 0, healer: 1, dps: 0, unknown: 1 });
    expect(got.raid).toEqual({ tank: 0, healer: 0, dps: 0, unknown: 1 });
  });
});

describe('roster-insights mainsOnly', () => {
  it('drops linked alts and keeps unlinked rows', () => {
    const got = mainsOnly([
      row('main', { userId: 1, isMain: true }),
      row('alt', { userId: 1 }),
      row('pug'),
    ]);
    expect(got.map((r) => r.name)).toEqual(['main', 'pug']);
  });
});

describe('roster-insights professions + freshness', () => {
  it('groups linked characters by profession with skill and source', () => {
    const r = row('crafter', { userId: 1 });
    const entry = {
      id: 1,
      slug: 'alchemy',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    };
    const linked: InsightRow = {
      ...r,
      facts: {
        ...EMPTY,
        professions: {
          value: {
            primary: [{ ...entry, name: 'Alchemy' }],
            secondary: [],
            syncedAt: AS_OF.toISOString(),
          },
          source: 'manual',
          asOf: null,
        },
      },
    };
    expect(computeProfessions([linked])).toEqual([
      {
        name: 'Alchemy',
        members: [
          {
            characterId: r.characterId,
            name: 'crafter',
            skill: 300,
            maxSkill: 300,
            source: 'manual',
          },
        ],
      },
    ]);
  });

  it('reports the oldest roster fact and per-character sources', () => {
    const older = new Date('2026-10-01T00:00:00.000Z');
    const got = computeFreshness([
      row('a', { asOf: older }),
      row('b', { userId: 1, source: 'addon' }),
      row('c', { userId: 2, source: 'blizzard' }),
    ]);
    expect(got.roster).toEqual({ source: 'roster', asOf: older.toISOString() });
    expect(got.characters).toEqual({ addon: 1, blizzard: 1, none: 0 });
  });

  it('a roster with no rows has null roster freshness', () => {
    expect(computeFreshness([])).toEqual({
      roster: null,
      characters: { addon: 0, blizzard: 0, none: 0 },
    });
  });
});
