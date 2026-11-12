/**
 * ROK-1927 — integrity of the hand-kept attunement dataset. Each rule is a
 * pure check returning problem lines, so a broken fixture proves the rule
 * names the defect (not just that the real dataset happens to pass).
 */
import {
  FOREVER_ATTUNEMENTS,
  attunementExtraQuestIds,
  attunementQuestSteps,
  finalAttunementQuest,
  type AttunementDef,
  type AttunementStep,
} from './forever-attunements';

function duplicateKeys(defs: readonly AttunementDef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of defs) {
    if (seen.has(d.key)) out.push(`duplicate key ${d.key}`);
    seen.add(d.key);
  }
  return out;
}

function duplicateQuestIds(defs: readonly AttunementDef[]): string[] {
  const out: string[] = [];
  for (const d of defs) {
    const ids = attunementQuestSteps(d).map((s) => s.questId);
    for (const id of new Set(ids)) {
      if (ids.filter((x) => x === id).length > 1) {
        out.push(`${d.key}: quest ${id} listed twice`);
      }
    }
  }
  return out;
}

function unpairedFactionVariants(defs: readonly AttunementDef[]): string[] {
  const out: string[] = [];
  for (const d of defs.filter((x) => x.faction !== 'both')) {
    const other = d.faction === 'horde' ? 'alliance' : 'horde';
    const pair = defs.filter(
      (x) => x.groupKey === d.groupKey && x.faction === other,
    );
    if (pair.length !== 1)
      out.push(`${d.key}: no ${other} pair in ${d.groupKey}`);
    if (pair.some((p) => p.instance !== d.instance)) {
      out.push(`${d.key}: pair instance name differs`);
    }
  }
  for (const d of defs.filter((x) => x.faction === 'both')) {
    if (defs.some((x) => x !== d && x.groupKey === d.groupKey)) {
      out.push(`${d.key}: a both-faction def shares group ${d.groupKey}`);
    }
  }
  return out;
}

function untrackable(step: AttunementStep): boolean {
  return step.kind === 'item' || step.kind === 'reputation';
}

function badFinalSteps(defs: readonly AttunementDef[]): string[] {
  const out: string[] = [];
  for (const d of defs) {
    const required = d.steps.filter((s) => !(s.kind === 'quest' && s.optional));
    const last = required[required.length - 1];
    if (d.trackable && last?.kind !== 'quest') {
      out.push(`${d.key}: last required step is ${last?.kind ?? 'missing'}`);
    }
    if (d.trackable && d.steps.some(untrackable)) {
      out.push(`${d.key}: trackable but has an item/reputation step`);
    }
    if (!d.trackable && !d.steps.some(untrackable)) {
      out.push(`${d.key}: untracked without an item/reputation step`);
    }
  }
  return out;
}

function missingExtraIds(
  defs: readonly AttunementDef[],
  extra: readonly number[],
): string[] {
  const set = new Set(extra);
  return defs.flatMap((d) =>
    attunementQuestSteps(d)
      .filter((s) => !set.has(s.questId))
      .map((s) => `${d.key}: quest ${s.questId} not in the extra ids`),
  );
}

const MC: AttunementDef = {
  key: 'mc-horde',
  groupKey: 'mc',
  instance: 'Molten Core',
  faction: 'horde',
  steps: [{ kind: 'quest', questId: 1, label: 'a' }],
  trackable: true,
  verifiedOn: null,
  source: 'test',
};

describe('FOREVER_ATTUNEMENTS integrity', () => {
  it('has unique keys', () => {
    expect(duplicateKeys(FOREVER_ATTUNEMENTS)).toEqual([]);
    expect(duplicateKeys([MC, MC])).toEqual(['duplicate key mc-horde']);
  });

  it('lists no quest id twice within a definition', () => {
    expect(duplicateQuestIds(FOREVER_ATTUNEMENTS)).toEqual([]);
    const twice = { ...MC, steps: [...MC.steps, ...MC.steps] };
    expect(duplicateQuestIds([twice])).toEqual([
      'mc-horde: quest 1 listed twice',
    ]);
  });

  it('pairs every faction variant under one groupKey', () => {
    expect(unpairedFactionVariants(FOREVER_ATTUNEMENTS)).toEqual([]);
    const alliance = {
      ...MC,
      key: 'mc-alliance',
      faction: 'alliance' as const,
    };
    const stray = { ...alliance, groupKey: 'molten' };
    expect(unpairedFactionVariants([MC, stray])).toEqual([
      'mc-horde: no alliance pair in mc',
      'mc-alliance: no horde pair in molten',
    ]);
    expect(unpairedFactionVariants([MC, alliance])).toEqual([]);
  });

  it('ends every tracked chain on a required quest', () => {
    expect(badFinalSteps(FOREVER_ATTUNEMENTS)).toEqual([]);
    const levelLast = {
      ...MC,
      steps: [...MC.steps, { kind: 'level' as const, min: 60, label: 'l' }],
    };
    expect(badFinalSteps([levelLast])).toEqual([
      'mc-horde: last required step is level',
    ]);
  });

  it('keeps untracked gates untracked and tracked gates quest-only', () => {
    const rep: AttunementStep = {
      kind: 'reputation',
      factionId: 529,
      standing: 'honored',
      label: 'r',
    };
    expect(badFinalSteps([{ ...MC, trackable: false }])).toEqual([
      'mc-horde: untracked without an item/reputation step',
    ]);
    expect(badFinalSteps([{ ...MC, steps: [rep, ...MC.steps] }])).toEqual([
      'mc-horde: trackable but has an item/reputation step',
    ]);
  });

  it('puts every quest id in the import extra ids', () => {
    const extra = attunementExtraQuestIds();
    expect(missingExtraIds(FOREVER_ATTUNEMENTS, extra)).toEqual([]);
    expect(missingExtraIds([MC], [])).toEqual([
      'mc-horde: quest 1 not in the extra ids',
    ]);
    expect(extra).toEqual([...new Set(extra)].sort((a, b) => a - b));
  });

  it('covers the v1 scope (MC, Onyxia, BWL tracked; Naxxramas untracked)', () => {
    const groups = (tracked: boolean) =>
      [
        ...new Set(
          FOREVER_ATTUNEMENTS.filter((d) => d.trackable === tracked).map(
            (d) => d.groupKey,
          ),
        ),
      ].sort();
    expect(groups(true)).toEqual(['bwl', 'mc', 'onyxia']);
    expect(groups(false)).toEqual(['naxx']);
  });

  it('dates verifiedOn as an ISO day or leaves it null', () => {
    for (const d of FOREVER_ATTUNEMENTS) {
      expect([d.key, d.verifiedOn]).toEqual([
        d.key,
        d.verifiedOn === null
          ? null
          : expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ]);
    }
  });
});

describe('finalAttunementQuest', () => {
  it('is the last non-optional quest step', () => {
    const steps: AttunementStep[] = [
      { kind: 'quest', questId: 1, label: 'a' },
      { kind: 'quest', questId: 2, label: 'b' },
      { kind: 'quest', questId: 3, label: 'c', optional: true },
    ];
    expect(finalAttunementQuest({ ...MC, steps })?.questId).toBe(2);
    expect(finalAttunementQuest({ ...MC, steps: [] })).toBeNull();
  });
});
