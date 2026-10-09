import { CharacterQuestsDtoSchema } from '@raid-ledger/contract';
import {
  buildCharacterQuests,
  type ForeverQuestSnapshotInput,
} from './character-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

const CAPTURED_AT = '2026-10-01T12:00:00.000Z';
const names = (id: number): string => `Name ${id}`;

function quest(
  over: Partial<DungeonQuestDto> & { questId: number },
): DungeonQuestDto {
  return {
    dungeonInstanceId: 100,
    name: `Quest ${over.questId}`,
    questLevel: 20,
    requiredLevel: 15,
    expansion: 'classic',
    questGiverNpc: null,
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: null,
    objectives: null,
    classRestriction: null,
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: null,
    ...over,
  };
}

function snap(
  completed: number[],
  inProgress: NonNullable<
    ForeverQuestSnapshotInput['quests']
  >['inProgress'] = [],
  completedTruncated?: boolean,
): ForeverQuestSnapshotInput {
  return {
    capturedAt: CAPTURED_AT,
    quests: { completed, inProgress, completedTruncated },
  };
}

describe('buildCharacterQuests — hidden cases', () => {
  it('returns null when the snapshot has no quests block (schema 1)', () => {
    expect(
      buildCharacterQuests({ capturedAt: CAPTURED_AT }, [], names),
    ).toBeNull();
  });

  it('returns null when completed and inProgress are both empty (R-6)', () => {
    expect(
      buildCharacterQuests(snap([], []), [quest({ questId: 1 })], names),
    ).toBeNull();
  });
});

describe('buildCharacterQuests — quest log mapping', () => {
  it('defaults missing title, objectives, have/need and instance to null/[]', () => {
    const dto = buildCharacterQuests(
      snap(
        [],
        [
          { questId: 92472 },
          { questId: 96638, objectives: [] },
          {
            questId: 5,
            title: 'Known',
            dungeonInstanceId: 230,
            objectives: [
              { text: 'Kill 8', done: false, have: 3, need: 8 },
              { text: 'Talk', done: true },
            ],
          },
        ],
      ),
      [],
      names,
    );
    expect(dto?.inProgress).toEqual([
      { questId: 92472, title: null, objectives: [], dungeonInstanceId: null },
      { questId: 96638, title: null, objectives: [], dungeonInstanceId: null },
      {
        questId: 5,
        title: 'Known',
        dungeonInstanceId: 230,
        objectives: [
          { text: 'Kill 8', done: false, have: 3, need: 8 },
          { text: 'Talk', done: true, have: null, need: null },
        ],
      },
    ]);
    expect(dto?.counts.inProgress).toBe(3);
  });
});

const known = [
  quest({
    questId: 1,
    dungeonInstanceId: 100,
    questLevel: 30,
    name: 'Bravo',
  }),
  quest({
    questId: 2,
    dungeonInstanceId: 100,
    questLevel: 25,
    name: 'Alpha',
  }),
  quest({ questId: 3, dungeonInstanceId: 200, questLevel: 15 }),
  quest({ questId: 4, dungeonInstanceId: 200, questLevel: 18 }),
  quest({ questId: 5, dungeonInstanceId: 300, questLevel: 10 }),
  quest({ questId: 6, dungeonInstanceId: null, questLevel: 1 }),
];
const completed = [
  ...Array.from({ length: 10_000 }, (_, i) => 100_000 + i),
  1,
  2,
  3,
  6,
];

describe('buildCharacterQuests — completed ∩ known', () => {
  it('groups by instance, skips null-instance and zero-completed groups', () => {
    const dto = buildCharacterQuests(snap(completed), known, names)!;
    expect(dto.completedKnown.map((g) => g.dungeonInstanceId)).toEqual([
      200, 100,
    ]);
    expect(dto.completedKnown.map((g) => g.instanceName)).toEqual([
      'Name 200',
      'Name 100',
    ]);
    expect(dto.completedKnown.map((g) => g.knownCount)).toEqual([2, 2]);
    expect(dto.completedKnown[1]!.completed.map((q) => q.name)).toEqual([
      'Alpha',
      'Bravo',
    ]);
  });

  it('reports counts and never leaks the raw completed ids', () => {
    const dto = buildCharacterQuests(snap(completed), known, names)!;
    expect(dto.counts).toEqual({
      completedKnown: 3,
      knownTotal: 6,
      completedTotal: 10_004,
      inProgress: 0,
    });
    expect(JSON.stringify(dto).length).toBeLessThan(2_000);
    expect(JSON.stringify(dto)).not.toContain('100000');
    expect(dto.syncedAt).toBe(CAPTURED_AT);
    expect(dto.source).toBe('addon');
    expect(CharacterQuestsDtoSchema.safeParse(dto).success).toBe(true);
  });
});

describe('buildCharacterQuests — ordering and edge cases', () => {
  it('breaks group-order ties by instance name', () => {
    const tie = [
      quest({ questId: 7, dungeonInstanceId: 9 }),
      quest({ questId: 8, dungeonInstanceId: 8 }),
    ];
    const nameOf = (id: number): string => (id === 9 ? 'Aaa' : 'Zzz');
    const dto = buildCharacterQuests(snap([7, 8]), tie, nameOf)!;
    expect(dto.completedKnown.map((g) => g.instanceName)).toEqual([
      'Aaa',
      'Zzz',
    ]);
  });

  it('keeps a non-null DTO with no groups when nothing overlaps (probe case)', () => {
    const dto = buildCharacterQuests(
      snap([92460, 92461], [{ questId: 92472 }]),
      known,
      names,
    )!;
    expect(dto).not.toBeNull();
    expect(dto.completedKnown).toEqual([]);
    expect(dto.counts).toEqual({
      completedKnown: 0,
      knownTotal: 6,
      completedTotal: 2,
      inProgress: 1,
    });
  });

  it('ignores the completedTruncated flag safely', () => {
    const dto = buildCharacterQuests(snap([1], [], true), known, names)!;
    expect(dto.counts.completedKnown).toBe(1);
    expect(dto).not.toHaveProperty('completedTruncated');
  });
});

describe('buildCharacterQuests — chains (D7)', () => {
  const chain = [
    quest({ questId: 10, nextQuestId: 11, questLevel: 20 }),
    quest({ questId: 11, prevQuestId: 10, nextQuestId: 12, questLevel: 22 }),
    quest({ questId: 12, prevQuestId: 11, questLevel: 24 }),
    quest({ questId: 13, questLevel: 26 }),
  ];

  it('marks chain steps done from the completed set', () => {
    const dto = buildCharacterQuests(snap([10, 11]), chain, names)!;
    const b = dto.completedKnown[0]!.completed.find((q) => q.questId === 11)!;
    expect(b.chain).toEqual([
      { questId: 10, name: 'Quest 10', done: true },
      { questId: 11, name: 'Quest 11', done: true },
      { questId: 12, name: 'Quest 12', done: false },
    ]);
  });

  it('always marks the completed quest itself done', () => {
    const dto = buildCharacterQuests(snap([12]), chain, names)!;
    const c = dto.completedKnown[0]!.completed[0]!;
    expect(c.chain.map((s) => [s.questId, s.done])).toEqual([
      [10, false],
      [11, false],
      [12, true],
    ]);
  });

  it('gives a standalone quest a chain of length <= 1', () => {
    const dto = buildCharacterQuests(snap([13]), chain, names)!;
    expect(
      dto.completedKnown[0]!.completed[0]!.chain.length,
    ).toBeLessThanOrEqual(1);
  });
});
