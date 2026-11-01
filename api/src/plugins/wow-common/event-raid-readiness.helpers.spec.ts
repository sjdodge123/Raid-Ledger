import {
  EventRaidReadinessSchema,
  type AddonLockout,
  type HubFactSource,
} from '@raid-ledger/contract';
import {
  buildRaidReadiness,
  buildRequirements,
  evaluateIlvl,
  evaluateLevel,
  evaluateQuests,
  evaluateSaved,
  oldestFreshness,
  overallState,
  parseContentInstances,
  type ReadinessFacts,
  type ReadinessInstance,
  type ReadinessSignupInput,
} from './event-raid-readiness.helpers';
import {
  findBlockingSave,
  lockoutMatchesInstance,
  normaliseInstanceName,
} from './event-raid-readiness.lockouts';
import type { Fact } from './facts/wow-fact.types';

const START = new Date('2026-11-07T20:00:00.000Z');
const START_S = START.getTime() / 1000;
const OLD = new Date('2026-10-30T12:00:00.000Z');
const NEW = new Date('2026-11-01T12:00:00.000Z');
const CHAR_ID = '11111111-1111-4111-8111-111111111111';

function fact<T>(
  value: T,
  source: HubFactSource = 'addon',
  asOf: Date | null = NEW,
): Fact<T> {
  return { value, source, asOf };
}

const inst = (over: Partial<ReadinessInstance> = {}): ReadinessInstance => ({
  id: 90_000_001,
  name: 'Barrow Deeps',
  shortName: 'BD',
  minimumLevel: 60,
  category: 'raid',
  ...over,
});

const lockout = (over: Partial<AddonLockout> = {}): AddonLockout => ({
  name: 'Barrow Deeps',
  instanceId: 249,
  difficultyId: 9,
  resetAt: START_S + 3600,
  killed: 2,
  total: 8,
  ...over,
});

const facts = (over: Partial<ReadinessFacts> = {}): ReadinessFacts => ({
  level: null,
  ilvl: null,
  lockouts: null,
  ...over,
});

const signup = (
  over: Partial<ReadinessSignupInput> = {},
): ReadinessSignupInput => ({
  userId: 7,
  characterId: CHAR_ID,
  name: 'Aldric',
  facts: facts(),
  perQuest: null,
  ...over,
});

const RAID_60 = [
  {
    id: 90_000_001,
    name: 'Barrow Deeps',
    shortName: 'BD',
    minimumLevel: 60,
    category: 'raid',
  },
];

describe('parseContentInstances', () => {
  it('keeps well-formed entries and drops ones without a string name', () => {
    const parsed = parseContentInstances([
      { id: 1, name: 'Molten Core', minimumLevel: 60, category: 'raid' },
      { id: 2, minimumLevel: 30 },
      'junk',
      null,
      { name: 'Deadmines', minimumLevel: 'x', category: 'weird', id: 'y' },
    ]);
    expect(parsed).toEqual([
      {
        id: 1,
        name: 'Molten Core',
        shortName: null,
        minimumLevel: 60,
        category: 'raid',
      },
      {
        id: null,
        name: 'Deadmines',
        shortName: null,
        minimumLevel: null,
        category: null,
      },
    ]);
  });

  it('returns [] for a non-array', () => {
    expect(parseContentInstances(null)).toEqual([]);
    expect(parseContentInstances({ name: 'x' })).toEqual([]);
  });
});

describe('buildRequirements', () => {
  it('uses the LOWEST known minimum level and its floor (rec 4/8)', () => {
    const req = buildRequirements(
      [
        inst({ name: 'Deadmines', minimumLevel: 26, category: 'dungeon' }),
        inst({
          name: 'Wailing Caverns',
          minimumLevel: null,
          category: 'dungeon',
        }),
        inst({
          name: 'Shadowfang Keep',
          minimumLevel: 30,
          category: 'dungeon',
        }),
      ],
      3,
    );
    expect(req).toEqual({
      minLevel: 26,
      ilvlFloor: 15,
      raidNames: [],
      questCount: 3,
    });
  });

  it('min 60 raid → floor 55, raid named', () => {
    expect(buildRequirements([inst()], 0)).toEqual({
      minLevel: 60,
      ilvlFloor: 55,
      raidNames: ['Barrow Deeps'],
      questCount: 0,
    });
  });

  it('no instance has a min → minLevel and ilvlFloor null', () => {
    const req = buildRequirements([inst({ minimumLevel: null })], 0);
    expect({ minLevel: req.minLevel, ilvlFloor: req.ilvlFloor }).toEqual({
      minLevel: null,
      ilvlFloor: null,
    });
  });
});

describe('evaluateLevel (a)', () => {
  it.each([
    [52, 60, 'fail'],
    [60, 60, 'pass'],
    [61, 60, 'pass'],
  ] as const)('level %d vs min %d → %s', (level, min, state) => {
    expect(evaluateLevel(fact(level, 'roster'), min)).toEqual({
      state,
      value: level,
      source: 'roster',
    });
  });

  it('no level fact → unknown (never fail)', () => {
    expect(evaluateLevel(null, 60)).toEqual({
      state: 'unknown',
      value: null,
      source: null,
    });
    expect(evaluateLevel(undefined, 60).state).toBe('unknown');
  });

  it('no min level → na', () => {
    expect(evaluateLevel(fact(10), null)).toEqual({
      state: 'na',
      value: null,
      source: null,
    });
  });
});

describe('evaluateIlvl (d)', () => {
  it('raw 54.5 vs floor 55 → fail, displayed value 55 (raw compare)', () => {
    expect(evaluateIlvl(fact(54.5), 55)).toEqual({
      state: 'fail',
      value: 55,
      source: 'addon',
    });
  });

  it('raw 55 → pass', () => {
    expect(evaluateIlvl(fact(55, 'blizzard'), 55)).toEqual({
      state: 'pass',
      value: 55,
      source: 'blizzard',
    });
  });

  it('no ilvl fact → unknown; no floor → na', () => {
    expect(evaluateIlvl(null, 55).state).toBe('unknown');
    expect(evaluateIlvl(fact(10), null).state).toBe('na');
  });
});

describe('evaluateQuests (b)', () => {
  const q = (
    state: 'done' | 'have' | 'missing' | 'unknown',
    prereqsMet: boolean | null = true,
  ) => ({
    state,
    prereqsMet,
  });

  it('questCount 0 → na', () => {
    expect(evaluateQuests([q('missing')], 0)).toEqual({
      state: 'na',
      ready: 0,
      total: 0,
    });
  });

  it('all done/have → pass with ready/total (done pre-reqs ignored)', () => {
    expect(
      evaluateQuests([q('done', null), q('have', false), q('done')], 3),
    ).toEqual({
      state: 'pass',
      ready: 3,
      total: 3,
    });
  });

  it('any missing → fail (rec 5)', () => {
    expect(evaluateQuests([q('done'), q('missing')], 2)).toEqual({
      state: 'fail',
      ready: 1,
      total: 2,
    });
  });

  it('an open quest with prereqsMet false → fail', () => {
    expect(evaluateQuests([q('done'), q('unknown', false)], 2).state).toBe(
      'fail',
    );
  });

  it('all-unknown or prereqsMet null → unknown', () => {
    expect(evaluateQuests([q('unknown'), q('unknown')], 2)).toEqual({
      state: 'unknown',
      ready: 0,
      total: 2,
    });
    expect(evaluateQuests([q('done'), q('unknown', null)], 2).state).toBe(
      'unknown',
    );
  });

  it('no quest row → unknown out of questCount; no usable quests → na', () => {
    expect(evaluateQuests(null, 4)).toEqual({
      state: 'unknown',
      ready: 0,
      total: 4,
    });
    expect(evaluateQuests([], 4)).toEqual({ state: 'na', ready: 0, total: 0 });
  });
});

describe('lockout matching (rec 6)', () => {
  it('normalises case and punctuation', () => {
    expect(normaliseInstanceName("The Barrow-Deeps' ")).toBe('thebarrowdeeps');
  });

  it('matches by id, by name, or by short name', () => {
    const raid = inst();
    expect(
      lockoutMatchesInstance({ instanceId: 90_000_001, name: 'X' }, raid),
    ).toBe(true);
    expect(
      lockoutMatchesInstance({ instanceId: 1, name: 'barrow deeps' }, raid),
    ).toBe(true);
    expect(lockoutMatchesInstance({ instanceId: 1, name: 'B.D.' }, raid)).toBe(
      true,
    );
    expect(
      lockoutMatchesInstance({ instanceId: 1, name: 'Hyjal Summit' }, raid),
    ).toBe(false);
    expect(
      lockoutMatchesInstance(
        { instanceId: 1, name: '---' },
        inst({ name: '', shortName: null }),
      ),
    ).toBe(false);
  });

  it('a save resetting at or before the start does not block (rec 7)', () => {
    expect(
      findBlockingSave(
        [lockout({ resetAt: START_S })],
        [inst()],
        START.getTime(),
      ),
    ).toBeNull();
    expect(
      findBlockingSave(
        [lockout({ resetAt: START_S + 1 })],
        [inst()],
        START.getTime(),
      ),
    ).not.toBeNull();
  });
});

describe('evaluateSaved (c)', () => {
  const raids = [inst()];

  it('matching save still locked at event start → fail with name + reset', () => {
    expect(evaluateSaved(fact([lockout()]), raids, START)).toEqual({
      state: 'fail',
      instanceName: 'Barrow Deeps',
      resetAt: new Date((START_S + 3600) * 1000).toISOString(),
    });
  });

  it('save expiring before the start → pass', () => {
    expect(
      evaluateSaved(fact([lockout({ resetAt: START_S - 60 })]), raids, START)
        .state,
    ).toBe('pass');
  });

  it('a save that matches no event raid never fails', () => {
    const other = lockout({ name: 'Hyjal Summit', instanceId: 2 });
    expect(evaluateSaved(fact([other]), raids, START).state).toBe('pass');
  });

  it('no lockouts fact → unknown; dungeon-only event → na', () => {
    expect(evaluateSaved(null, raids, START).state).toBe('unknown');
    expect(evaluateSaved(fact([lockout()]), [], START)).toEqual({
      state: 'na',
      instanceName: null,
      resetAt: null,
    });
  });
});

describe('overallState', () => {
  it.each([
    [['pass', 'fail', 'unknown', 'na'], 'fail'],
    [['pass', 'unknown', 'na', 'pass'], 'unknown'],
    [['pass', 'na', 'na', 'pass'], 'pass'],
    [['na', 'na', 'na', 'na'], 'pass'],
  ] as const)('%j → %s', (states, expected) => {
    expect(overallState(states)).toBe(expected);
  });
});

describe('unknown never fails (AC7)', () => {
  const instanceSets = [
    RAID_60,
    [{ ...RAID_60[0], category: 'dungeon' }],
    [],
    [{ name: 'X' }],
  ];
  const missing: ReadinessSignupInput[] = [
    signup({ facts: null, perQuest: null, characterId: null }),
    signup({ facts: facts(), perQuest: null }),
    signup({
      facts: facts(),
      perQuest: [{ state: 'unknown', prereqsMet: null }],
    }),
  ];

  it.each(instanceSets.flatMap((ci) => [0, 3].map((qc) => [ci, qc] as const)))(
    'every fact missing is never fail (instances %j, questCount %d)',
    (contentInstances, questCount) => {
      const out = buildRaidReadiness({
        event: { id: 1, title: 'Run', startTime: START, contentInstances },
        questCount,
        signups: missing,
      });
      for (const row of out.signups) {
        expect({ name: row.name, overall: row.overall }).not.toEqual({
          name: row.name,
          overall: 'fail',
        });
        expect([
          row.level.state,
          row.quests.state,
          row.saved.state,
          row.ilvl.state,
        ]).not.toContain('fail');
      }
    },
  );

  it('na never changes overall: an all-pass row stays pass when other checks are na', () => {
    const out = buildRaidReadiness({
      event: {
        id: 1,
        title: 'Run',
        startTime: START,
        contentInstances: [{ name: 'X', category: 'dungeon' }],
      },
      questCount: 0,
      signups: [signup({ facts: facts({ level: fact(60), ilvl: fact(60) }) })],
    });
    expect(out.signups[0]?.overall).toBe('pass');
  });
});

describe('buildRaidReadiness', () => {
  const event = {
    id: 42,
    title: 'Barrow Deeps Night',
    startTime: START,
    contentInstances: RAID_60,
  };

  it('builds a contract-valid payload per signup (AC3/5/6)', () => {
    const out = buildRaidReadiness({
      event,
      questCount: 0,
      signups: [
        signup({
          userId: 1,
          name: 'Low',
          facts: facts({
            level: fact(52, 'roster', OLD),
            ilvl: fact(40),
            lockouts: fact([]),
          }),
        }),
        signup({
          userId: 2,
          name: 'Saved',
          facts: facts({
            level: fact(60),
            ilvl: fact(54.5),
            lockouts: fact([lockout()]),
          }),
        }),
        signup({
          userId: 3,
          name: 'Ready',
          facts: facts({ level: fact(60), ilvl: fact(58), lockouts: fact([]) }),
        }),
        signup({ userId: 4, name: 'Pug', characterId: null, facts: null }),
      ],
    });
    expect(EventRaidReadinessSchema.safeParse(out).success).toBe(true);
    expect(out.requirements).toEqual({
      minLevel: 60,
      ilvlFloor: 55,
      raidNames: ['Barrow Deeps'],
      questCount: 0,
    });
    expect(
      out.signups.map((s) => [
        s.name,
        s.level.state,
        s.saved.state,
        s.ilvl.state,
        s.overall,
      ]),
    ).toEqual([
      ['Low', 'fail', 'pass', 'fail', 'fail'],
      ['Saved', 'pass', 'fail', 'fail', 'fail'],
      ['Ready', 'pass', 'pass', 'pass', 'pass'],
      ['Pug', 'unknown', 'unknown', 'unknown', 'unknown'],
    ]);
    expect(out.event).toEqual({
      id: 42,
      title: 'Barrow Deeps Night',
      startTime: START.toISOString(),
    });
    expect(out.freshness).toEqual({
      source: 'roster',
      asOf: OLD.toISOString(),
    });
  });

  it('caps signups at 100 and names at 64 chars', () => {
    const out = buildRaidReadiness({
      event,
      questCount: 0,
      signups: Array.from({ length: 105 }, (_, i) =>
        signup({ userId: i + 1, name: 'n'.repeat(80) }),
      ),
    });
    expect({
      count: out.signups.length,
      nameLen: out.signups[0]?.name.length,
    }).toEqual({ count: 100, nameLen: 64 });
  });
});

describe('oldestFreshness', () => {
  it('null when no fact fed a cell', () => {
    expect(oldestFreshness([])).toBeNull();
  });

  it('a dated fact beats an undated one; the oldest wins', () => {
    expect(
      oldestFreshness([
        fact(1, 'manual', null),
        fact(1, 'addon', NEW),
        fact(1, 'roster', OLD),
      ]),
    ).toEqual({ source: 'roster', asOf: OLD.toISOString() });
  });

  it('all undated → first source, asOf null', () => {
    expect(oldestFreshness([fact(1, 'blizzard', null)])).toEqual({
      source: 'blizzard',
      asOf: null,
    });
  });

  it('ignores facts behind an na cell', () => {
    const out = buildRaidReadiness({
      event: { id: 1, title: 'Run', startTime: START, contentInstances: [] },
      questCount: 0,
      signups: [signup({ facts: facts({ level: fact(60, 'roster', OLD) }) })],
    });
    expect(out.freshness).toBeNull();
  });
});
