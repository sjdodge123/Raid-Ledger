import type { AddonLockout } from '@raid-ledger/contract';
import type { ResolvedWowFacts } from '../../facts/wow-fact.types';
import {
  computeLockouts,
  countLockoutReporters,
} from './roster-insights.lockouts';
import type { InsightRow } from './roster-insights.types';

const NOW_S = 1_800_000_000;
const NOW_MS = NOW_S * 1000;
const iso = (s: number): string => new Date(s * 1000).toISOString();
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
};

function lock(o: Partial<AddonLockout> = {}): AddonLockout {
  return {
    name: 'Molten Core',
    instanceId: 409,
    difficultyId: 9,
    resetAt: NOW_S + 3600,
    killed: 3,
    total: 10,
    ...o,
  };
}

function row(
  name: string,
  lockouts: AddonLockout[] | null,
  characterId: string | null = `char-${name}`,
): InsightRow {
  return {
    name,
    characterId,
    userId: characterId === null ? null : 1,
    isMain: true,
    rankIndex: 0,
    facts: {
      ...EMPTY,
      lockouts:
        lockouts === null
          ? null
          : { value: lockouts, source: 'addon', asOf: null },
    },
  };
}

describe('computeLockouts (ROK-1914)', () => {
  it('groups members by instance save, members sorted by name', () => {
    const out = computeLockouts(
      [row('Zed', [lock({ killed: 10 })]), row('Ana', [lock()])],
      NOW_MS,
    );
    expect(out).toEqual([
      {
        instanceId: 409,
        difficultyId: 9,
        name: 'Molten Core',
        difficulty: '40 Player',
        total: 10,
        resetAt: iso(NOW_S + 3600),
        members: [
          {
            characterId: 'char-Ana',
            name: 'Ana',
            killed: 3,
            resetAt: iso(NOW_S + 3600),
          },
          {
            characterId: 'char-Zed',
            name: 'Zed',
            killed: 10,
            resetAt: iso(NOW_S + 3600),
          },
        ],
      },
    ]);
  });

  it('splits the same instance at two difficulties into two groups', () => {
    const out = computeLockouts(
      [
        row('Ana', [
          lock({ instanceId: 36, difficultyId: 1, name: 'Deadmines' }),
        ]),
        row('Bo', [
          lock({ instanceId: 36, difficultyId: 2, name: 'Deadmines' }),
        ]),
      ],
      NOW_MS,
    );
    expect(out.map((g) => [g.difficultyId, g.difficulty])).toEqual([
      [1, 'Normal'],
      [2, 'Heroic'],
    ]);
  });

  it('drops a lockout resetting exactly at now, and an emptied group', () => {
    const out = computeLockouts(
      [
        row('Ana', [lock({ resetAt: NOW_S })]),
        row('Bo', [
          lock({ instanceId: 1, name: 'Onyxia', resetAt: NOW_S + 1 }),
        ]),
      ],
      NOW_MS,
    );
    expect(out.map((g) => g.name)).toEqual(['Onyxia']);
  });

  it('skips unlinked rows and rows with no lockouts fact', () => {
    const out = computeLockouts(
      [row('Ghost', [lock()], null), row('Bo', null), row('Ana', [lock()])],
      NOW_MS,
    );
    expect(out[0]?.members.map((m) => m.name)).toEqual(['Ana']);
  });

  it('sorts groups by member count desc, then name; header = soonest reset', () => {
    const ony = { instanceId: 1, name: 'Onyxia' };
    const out = computeLockouts(
      [
        row('Ana', [lock({ ...ony, resetAt: NOW_S + 900 }), lock()]),
        row('Bo', [lock({ ...ony, resetAt: NOW_S + 60 })]),
        row('Cy', [lock({ instanceId: 2, name: 'Blackwing Lair' })]),
      ],
      NOW_MS,
    );
    expect(out.map((g) => g.name)).toEqual([
      'Onyxia',
      'Blackwing Lair',
      'Molten Core',
    ]);
    expect(out[0]?.resetAt).toBe(iso(NOW_S + 60));
    expect(out[0]?.members.map((m) => m.resetAt)).toEqual([
      iso(NOW_S + 900),
      iso(NOW_S + 60),
    ]);
  });

  it('returns [] when nobody is saved, and a null label for an unmapped id', () => {
    expect(computeLockouts([row('Ana', [])], NOW_MS)).toEqual([]);
    const out = computeLockouts(
      [row('Ana', [lock({ difficultyId: 77 })])],
      NOW_MS,
    );
    expect(out[0]?.difficulty).toBeNull();
  });

  it('lists a character once when its snapshot repeats a save, keeping the higher kill count', () => {
    const out = computeLockouts(
      [
        row('Ana', [lock({ killed: 2 }), lock({ killed: 7 })]),
        row('Bo', [lock()]),
      ],
      NOW_MS,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.members.map((m) => [m.name, m.killed])).toEqual([
      ['Ana', 7],
      ['Bo', 3],
    ]);
  });
});

describe('countLockoutReporters (ROK-1914)', () => {
  it('counts linked characters with a lockouts fact, an empty list included', () => {
    const rows = [
      row('Ana', [lock()]),
      row('Bo', []),
      row('Cy', null),
      row('Di', [lock()], null),
    ];
    expect(countLockoutReporters(rows)).toBe(2);
  });
});
