/**
 * ROK-1927 (P6) — the seed-attunements fixture's body schema and cast plan.
 * The DB writes are exercised end to end by `forever-attunements.smoke.spec.ts`.
 */
import {
  FOREVER_ATTUNEMENTS,
  finalAttunementQuest,
} from '../plugins/wow-common/data/forever-attunements';
import {
  IN_PROGRESS_STEPS,
  SEEDED_ATTUNEMENT_KEY,
  SeedAttunementsSchema,
  attunementSeedPlan,
} from './demo-test-attunements.helpers';

const UUID = '7f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60';

describe('SeedAttunementsSchema', () => {
  it('accepts three character uuids', () => {
    const body = {
      characters: { done: UUID, inProgress: UUID, notStarted: UUID },
    };
    expect(SeedAttunementsSchema.safeParse(body).success).toBe(true);
  });

  it('rejects a missing role, a non-uuid id and unknown keys', () => {
    const bad = [
      { characters: { done: UUID, inProgress: UUID } },
      { characters: { done: 'x', inProgress: UUID, notStarted: UUID } },
      {
        characters: { done: UUID, inProgress: UUID, notStarted: UUID },
        extra: 1,
      },
    ];
    for (const body of bad) {
      expect(SeedAttunementsSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('attunementSeedPlan', () => {
  const plan = attunementSeedPlan();
  const def = FOREVER_ATTUNEMENTS.find((d) => d.key === SEEDED_ATTUNEMENT_KEY);

  it('confirms the Horde Onyxia chain, final quest included', () => {
    expect(plan.def.key).toBe('ony-horde');
    expect(plan.def.faction).toBe('horde');
    const finalId = def ? finalAttunementQuest(def)?.questId : undefined;
    expect(plan.steps.map((s) => s.questId)).toContain(finalId);
  });

  it('gives done the whole chain, inProgress a strict prefix, notStarted nothing', () => {
    const ids = plan.steps.map((s) => s.questId);
    expect(plan.completed.done).toEqual(ids);
    expect(plan.completed.inProgress).toEqual(ids.slice(0, IN_PROGRESS_STEPS));
    expect(plan.completed.inProgress.length).toBeLessThan(ids.length);
    expect(plan.completed.inProgress).not.toContain(ids[ids.length - 1]);
    expect(plan.completed.notStarted).toEqual([]);
  });
});
