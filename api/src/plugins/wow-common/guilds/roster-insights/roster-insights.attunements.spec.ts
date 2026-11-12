import type { WowRosterAttunementsDto } from '@raid-ledger/contract';
import {
  FOREVER_ATTUNEMENTS,
  attunementExtraQuestIds,
  type AttunementDef,
} from '../../data/forever-attunements';
import type { EffectiveQuests } from '../../forever-quest-source.helpers';
import {
  computeAttunements,
  factionOfRace,
  type AttunementMemberInput,
} from './roster-insights.attunements';

const CHAIN: AttunementDef = {
  key: 'chain',
  groupKey: 'chain',
  instance: 'Test Lair',
  faction: 'both',
  steps: [
    { kind: 'level', min: 55, label: 'Reach level 55' },
    { kind: 'quest', questId: 100, label: 'Step one' },
    { kind: 'quest', questId: 200, label: 'Step two' },
    { kind: 'quest', questId: 300, label: 'Final step' },
  ],
  trackable: true,
  verifiedOn: null,
  source: 'test',
};

const REP: AttunementDef = {
  ...CHAIN,
  key: 'rep',
  groupKey: 'rep',
  instance: 'Rep Hall',
  steps: [
    {
      kind: 'reputation',
      factionId: 529,
      standing: 'honored',
      label: 'Honored with the Argent Dawn',
    },
  ],
  trackable: false,
};

const ALL = new Set([100, 200, 300]);
const AT = new Date('2026-11-01T00:00:00.000Z');

function quests(
  completed: number[],
  extra: Partial<EffectiveQuests['quests']> = {},
  capturedAt = AT,
): EffectiveQuests {
  return {
    quests: { completed, inProgress: [], ...extra },
    capturedAt,
    source: 'blizzard',
    inProgressAsOf: null,
  };
}

function member(
  over: Partial<AttunementMemberInput> = {},
): AttunementMemberInput {
  return {
    rowKey: 'c1',
    name: 'Thrall',
    characterId: '11111111-1111-4111-8111-111111111111',
    cls: 'Shaman',
    level: 60,
    faction: 'horde',
    quests: quests([]),
    ...over,
  };
}

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

function only(dto: WowRosterAttunementsDto, key = 'chain') {
  const m = must(dto.members[0], 'member');
  return must(
    m.results.find((r) => r.key === key),
    `result ${key}`,
  );
}

function run(m: AttunementMemberInput, confirmed = ALL) {
  return computeAttunements([CHAIN], confirmed, [m]);
}

describe('computeAttunements — verdicts (§7, ROK-1927)', () => {
  it('final quest alone = done (ruling Q3), all steps counted', () => {
    const r = only(run(member({ quests: quests([300]) })));
    expect(r).toEqual({
      key: 'chain',
      state: 'done',
      noDataReason: null,
      stepsDone: 3,
      nextStep: null,
      belowLevel: false,
    });
  });

  it('an earlier step completed = in_progress with the next step label', () => {
    const r = only(run(member({ quests: quests([100]) })));
    expect(r.state).toBe('in_progress');
    expect(r.stepsDone).toBe(1);
    expect(r.nextStep).toBe('Step two');
  });

  it('a step in the addon quest log = in_progress', () => {
    const log = quests([], { inProgress: [{ questId: 100 }] });
    const r = only(run(member({ quests: log })));
    expect(r.state).toBe('in_progress');
    expect(r.stepsDone).toBe(0);
  });

  it('nothing completed = not_started with the first step next', () => {
    const r = only(run(member({ quests: quests([42]) })));
    expect(r.state).toBe('not_started');
    expect(r.nextStep).toBe('Step one');
  });

  it('no quest data = no_data, never not_started', () => {
    const r = only(run(member({ quests: null })));
    expect(r.state).toBe('no_data');
    expect(r.noDataReason).toBe('no_quest_data');
  });

  it('an unclaimed member = no_data not_claimed', () => {
    const m = member({ characterId: null, quests: null, rowKey: 'm7' });
    const dto = run(m);
    expect(only(dto).noDataReason).toBe('not_claimed');
    expect(dto.members[0]?.characterId).toBeNull();
  });

  it('a truncated list whose ids lie above the cut-off = no_data truncated', () => {
    const cut = quests([150], { completedTruncated: true });
    const r = only(run(member({ quests: cut })));
    expect(r.state).toBe('no_data');
    expect(r.noDataReason).toBe('truncated');
  });

  it('a truncated list that covers every step id is still read', () => {
    const cut = quests([100, 400], { completedTruncated: true });
    expect(only(run(member({ quests: cut }))).state).toBe('in_progress');
  });

  it('below the level step is an annotation, the state still computed', () => {
    const r = only(run(member({ level: 52, quests: quests([100]) })));
    expect(r.belowLevel).toBe(true);
    expect(r.state).toBe('in_progress');
  });
});

describe('computeAttunements — confirmed ids (Lead call 2026-11-12)', () => {
  it('hides a def whose final quest id is unconfirmed', () => {
    const dto = run(member({ quests: quests([300]) }), new Set([100, 200]));
    expect(dto).toEqual({ attunements: [], members: [], oldestAsOf: null });
  });

  it('drops an unconfirmed intermediate step from labels, count and log', () => {
    const log = quests([200], { inProgress: [{ questId: 200 }] });
    const dto = run(member({ quests: log }), new Set([100, 300]));
    expect(dto.attunements[0]?.steps).toEqual(['Step one', 'Final step']);
    const r = only(dto);
    expect(r.state).toBe('not_started');
    expect(r.stepsDone).toBe(0);
  });

  it('only untracked defs left = the empty "not verified yet" payload', () => {
    const dto = computeAttunements([CHAIN, REP], new Set(), [member()]);
    expect(dto.attunements).toEqual([]);
  });

  it('untracked defs list greyed with a reason, zero counts, no result', () => {
    const dto = computeAttunements([CHAIN, REP], ALL, [member()]);
    const rep = dto.attunements.find((a) => a.key === 'rep');
    expect(rep).toMatchObject({
      trackable: false,
      untrackedReason: "Reputation isn't synced yet",
      steps: ['Honored with the Argent Dawn'],
      counts: { done: 0, inProgress: 0, notStarted: 0, noData: 0 },
    });
    expect(dto.members[0]?.results.map((r) => r.key)).toEqual(['chain']);
  });
});

describe('computeAttunements — faction, counts and freshness', () => {
  const confirmed = new Set(attunementExtraQuestIds());

  it('a Horde character gets the Horde chains only (D7)', () => {
    const dto = computeAttunements(FOREVER_ATTUNEMENTS, confirmed, [member()]);
    const keys = dto.members[0]?.results.map((r) => r.key);
    expect(keys).toEqual(['mc-horde', 'ony-horde', 'bwl']);
  });

  it('an Alliance character gets the Alliance chains only', () => {
    const m = member({ faction: 'alliance' });
    const dto = computeAttunements(FOREVER_ATTUNEMENTS, confirmed, [m]);
    const keys = dto.members[0]?.results.map((r) => r.key);
    expect(keys).toEqual(['mc-alliance', 'ony-alliance', 'bwl']);
  });

  it('tallies per def and reports the oldest asOf', () => {
    const old = new Date('2026-10-01T00:00:00.000Z');
    const dto = computeAttunements([CHAIN], ALL, [
      member({ rowKey: 'a', quests: quests([300]) }),
      member({ rowKey: 'b', quests: quests([100], {}, old) }),
      member({ rowKey: 'c', quests: quests([]) }),
      member({ rowKey: 'd', characterId: null, quests: null }),
    ]);
    expect(dto.attunements[0]?.counts).toEqual({
      done: 1,
      inProgress: 1,
      notStarted: 1,
      noData: 1,
    });
    expect(dto.oldestAsOf).toBe(old.toISOString());
  });

  it('never sends a quest id (AC10)', () => {
    const json = JSON.stringify(run(member({ quests: quests([100]) })));
    expect(json).not.toMatch(/\b(100|200|300)\b/);
  });
});

describe('factionOfRace', () => {
  it.each([
    ['Undead', 'horde'],
    ['Scourge', 'horde'],
    ['Night Elf', 'alliance'],
    ['NightElf', 'alliance'],
    ['Pandaren', null],
    [null, null],
  ])('%s → %s', (race, side) => {
    expect(factionOfRace(race)).toBe(side);
  });
});
