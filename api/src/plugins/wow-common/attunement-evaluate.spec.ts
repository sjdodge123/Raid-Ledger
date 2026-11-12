/**
 * ROK-1927 (P5-api) — the shared per-character attunement step evaluator and
 * the character page's own checklists built on it.
 */
import type { AttunementDef } from './data/forever-attunements';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import {
  attunementChecklist,
  evaluateAttunement,
  visibleDefs,
  type VisibleDef,
} from './attunement-evaluate';
import { computeCharacterAttunements } from './character-attunements';

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
const HORDE: AttunementDef = { ...CHAIN, key: 'h', faction: 'horde' };
const ALLIANCE: AttunementDef = { ...CHAIN, key: 'a', faction: 'alliance' };
const UNTRACKED: AttunementDef = { ...CHAIN, key: 'u', trackable: false };
const ALL = new Set([100, 200, 300]);

function quests(
  completed: number[],
  extra: Partial<EffectiveQuests['quests']> = {},
): EffectiveQuests {
  return {
    quests: { completed, inProgress: [], ...extra },
    capturedAt: new Date('2026-11-01T00:00:00.000Z'),
    source: 'blizzard',
    inProgressAsOf: null,
  };
}

function visible(confirmed: ReadonlySet<number> = ALL): VisibleDef {
  const [v] = visibleDefs([CHAIN], confirmed);
  if (!v) throw new Error('CHAIN is not visible');
  return v;
}

describe('evaluateAttunement', () => {
  it('is not started with no chain quest completed', () => {
    expect(evaluateAttunement(visible(), quests([5]))).toEqual({
      state: 'not_started',
      noDataReason: null,
      stepsDone: 0,
      nextStep: 'Step one',
    });
  });

  it('is in progress with the next incomplete step', () => {
    const r = evaluateAttunement(visible(), quests([100]));
    expect(r).toMatchObject({ state: 'in_progress', stepsDone: 1 });
    expect(r.nextStep).toBe('Step two');
  });

  it('is in progress when a step sits in the quest log only', () => {
    const q = quests([], { inProgress: [{ questId: 100 }] });
    expect(evaluateAttunement(visible(), q).state).toBe('in_progress');
  });

  it('is done when the final quest alone is completed (ruling Q3)', () => {
    expect(evaluateAttunement(visible(), quests([300]))).toEqual({
      state: 'done',
      noDataReason: null,
      stepsDone: 3,
      nextStep: null,
    });
  });

  it('is no data without quests and truncated above the cut-off', () => {
    expect(evaluateAttunement(visible(), null).noDataReason).toBe(
      'no_quest_data',
    );
    const cut = quests([150], { completedTruncated: true });
    expect(evaluateAttunement(visible(), cut).noDataReason).toBe('truncated');
  });

  it('drops an unconfirmed intermediate step from the count', () => {
    const v = visible(new Set([100, 300]));
    expect(evaluateAttunement(v, quests([100, 200]))).toMatchObject({
      stepsDone: 1,
      nextStep: 'Final step',
    });
  });
});

describe('attunementChecklist', () => {
  it('flags each confirmed step done in chain order', () => {
    expect(attunementChecklist(visible(), quests([100]))).toEqual([
      { label: 'Step one', done: true },
      { label: 'Step two', done: false },
      { label: 'Final step', done: false },
    ]);
  });

  it('marks every step done once the final quest is completed', () => {
    const steps = attunementChecklist(visible(), quests([300]));
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it('omits an unconfirmed intermediate step', () => {
    const v = visible(new Set([100, 300]));
    expect(attunementChecklist(v, null).map((s) => s.label)).toEqual([
      'Step one',
      'Final step',
    ]);
  });
});

describe('computeCharacterAttunements', () => {
  const defs = [CHAIN, HORDE, ALLIANCE, UNTRACKED];
  const input = { faction: 'horde' as const, level: 52, quests: quests([100]) };

  it('keeps only tracked defs of the character faction', () => {
    const keys = computeCharacterAttunements(defs, ALL, input).map(
      (a) => a.key,
    );
    expect(keys).toEqual(['chain', 'h']);
  });

  it('gives only `both` defs to an unknown faction', () => {
    const out = computeCharacterAttunements(defs, ALL, {
      ...input,
      faction: null,
    });
    expect(out.map((a) => a.key)).toEqual(['chain']);
  });

  it('hides a def whose final quest is unconfirmed', () => {
    const out = computeCharacterAttunements(defs, new Set([100, 200]), input);
    expect(out).toEqual([]);
  });

  it('carries the level gate, next step and checklist', () => {
    const [a] = computeCharacterAttunements([CHAIN], ALL, input);
    expect(a).toEqual({
      key: 'chain',
      groupKey: 'chain',
      instance: 'Test Lair',
      state: 'in_progress',
      belowLevel: true,
      requiredLevel: 55,
      nextStep: 'Step two',
      steps: [
        { label: 'Step one', done: true },
        { label: 'Step two', done: false },
        { label: 'Final step', done: false },
      ],
    });
  });
});
