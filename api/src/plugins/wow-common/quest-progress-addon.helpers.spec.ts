/**
 * ROK-1748 L5b: pure addon-progress helpers — derivation (D6), precedence
 * (D5), partial-insert fill (D5) and per-viewer chain marking (D12).
 */
import {
  QuestPrereqStateSchema,
  QuestProgressDtoSchema,
} from '@raid-ledger/contract';
import type { DungeonQuestDto } from './dungeon-quests.types';
import {
  buildPrereqState,
  countNeeded,
  deriveAddonProgress,
  doneLookupFromRows,
  fillFromAddon,
  mergeProgress,
  type AddonProgressRow,
  type ManualProgressRow,
} from './quest-progress-addon.helpers';

const CHAR = '11111111-1111-4111-8111-111111111111';
const CAPTURED = '2026-10-09T12:00:00.000Z';
const UPDATED = new Date('2026-10-09T13:00:00.000Z');

function addon(questId: number, over: Partial<AddonProgressRow> = {}) {
  return {
    userId: 1,
    questId,
    characterId: CHAR,
    pickedUp: false,
    completed: false,
    source: 'addon' as const,
    asOf: CAPTURED,
    ...over,
  };
}

function manual(questId: number, over: Partial<ManualProgressRow> = {}) {
  return {
    id: 7,
    userId: 1,
    questId,
    pickedUp: false,
    completed: false,
    updatedAt: UPDATED,
    ...over,
  };
}

function quest(id: number, prev: number | null, next: number | null) {
  return {
    questId: id,
    name: `Q${id}`,
    prevQuestId: prev,
    nextQuestId: next,
  } as DungeonQuestDto;
}

function only<T>(xs: T[]): T {
  const [x] = xs;
  if (x === undefined) throw new Error('expected one element');
  return x;
}

describe('deriveAddonProgress (D6)', () => {
  const snapshot = {
    capturedAt: CAPTURED,
    quests: {
      completed: [10, 99],
      inProgress: [{ questId: 20 }, { questId: 98 }],
    },
  };

  it('maps completed and in-progress quests with addon source/asOf', () => {
    const rows = deriveAddonProgress(snapshot, new Set([10, 20]), 1, CHAR);
    expect(rows).toEqual([
      addon(10, { completed: true }),
      addon(20, { pickedUp: true }),
    ]);
  });

  it('drops quest ids outside the known set', () => {
    const rows = deriveAddonProgress(snapshot, new Set([20]), 1, CHAR);
    expect(rows.map((r) => r.questId)).toEqual([20]);
  });

  it('completed implies not pickedUp even when also in progress', () => {
    const both = {
      capturedAt: CAPTURED,
      quests: { completed: [10], inProgress: [{ questId: 10 }] },
    };
    const rows = deriveAddonProgress(both, new Set([10]), 1, CHAR);
    expect(rows).toEqual([addon(10, { completed: true })]);
  });
});

describe('mergeProgress (D5)', () => {
  it('addon only → addon row (synthetic id 0)', () => {
    const [row] = mergeProgress([], [addon(10, { completed: true })]);
    expect(row).toMatchObject({
      id: 0,
      completed: true,
      source: 'addon',
      asOf: CAPTURED,
      characterId: CHAR,
    });
  });

  it('manual true beats addon false on both fields', () => {
    const rows = mergeProgress(
      [manual(10, { pickedUp: true, completed: true })],
      [addon(10)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 7,
      pickedUp: true,
      completed: true,
      source: 'manual',
      asOf: UPDATED.toISOString(),
      characterId: null,
    });
  });

  it('manual false beats addon true on both fields (untick wins)', () => {
    const rows = mergeProgress(
      [manual(10)],
      [addon(10, { completed: true }), addon(20, { pickedUp: true })],
    );
    const forTen = rows.filter((r) => r.questId === 10);
    expect(forTen).toHaveLength(1);
    expect(forTen[0]).toMatchObject({
      pickedUp: false,
      completed: false,
      source: 'manual',
    });
  });

  it('keeps manual rows when there is no snapshot', () => {
    const rows = mergeProgress([manual(10, { pickedUp: true })], []);
    expect(rows.map((r) => [r.questId, r.source])).toEqual([[10, 'manual']]);
  });

  it('precedence is per user — another user’s manual row does not mask', () => {
    const rows = mergeProgress([manual(10, { userId: 2 })], [addon(10)]);
    expect(rows.map((r) => [r.userId, r.source])).toEqual([
      [2, 'manual'],
      [1, 'addon'],
    ]);
  });

  it('neither → nothing', () => {
    expect(mergeProgress([], [])).toEqual([]);
  });
});

describe('mergeProgress output contract', () => {
  it('output parses as a QuestProgressDto once a username is attached', () => {
    const rows = mergeProgress([manual(10)], [addon(20)]);
    for (const r of rows) {
      expect(() =>
        QuestProgressDtoSchema.parse({ ...r, eventId: 1, username: 'u' }),
      ).not.toThrow();
    }
  });
});

describe('fillFromAddon (D5 insert rule)', () => {
  const a = addon(10, { completed: true });

  it('unspecified field takes the addon value', () => {
    expect(fillFromAddon({ pickedUp: true }, a)).toEqual({
      pickedUp: true,
      completed: true,
    });
  });

  it('specified fields win over the addon value', () => {
    expect(fillFromAddon({ completed: false }, a)).toEqual({
      pickedUp: false,
      completed: false,
    });
  });

  it('no addon row → unspecified fields default to false', () => {
    expect(fillFromAddon({ pickedUp: true }, undefined)).toEqual({
      pickedUp: true,
      completed: false,
    });
  });
});

describe('buildPrereqState (D12)', () => {
  const q1 = quest(1, null, 2);
  const q2 = quest(2, 1, 3);
  const q3 = quest(3, 2, null);
  const lone = quest(9, null, null);
  const lookup = new Map([q1, q2, q3, lone].map((q) => [q.questId, q]));
  const done = doneLookupFromRows(
    mergeProgress(
      [manual(1, { completed: true })],
      [addon(2, { completed: true }), addon(3, { pickedUp: true })],
    ),
  );

  it('marks chain steps before the quest with their sources', () => {
    const state = only(buildPrereqState([q3], lookup, done));
    expect(state.steps).toEqual([
      { questId: 1, name: 'Q1', done: true, source: 'manual' },
      { questId: 2, name: 'Q2', done: true, source: 'addon' },
    ]);
    expect(state.completed).toBe(false);
    expect(state.completedSource).toBe('addon');
    expect(() => QuestPrereqStateSchema.parse(state)).not.toThrow();
  });

  it('counts steps not done (middle via addon, first not done → 1)', () => {
    const partial = doneLookupFromRows(
      mergeProgress([manual(1)], [addon(2, { completed: true })]),
    );
    const state = only(buildPrereqState([q3], lookup, partial));
    expect(state.steps.map((s) => [s.done, s.source])).toEqual([
      [false, 'manual'],
      [true, 'addon'],
    ]);
    expect(state.neededCount).toBe(1);
  });

  it('quest with no chain → steps [] and neededCount 0', () => {
    const state = only(buildPrereqState([lone], lookup, done));
    expect(state).toEqual({
      questId: 9,
      steps: [],
      neededCount: 0,
      completed: false,
      completedSource: null,
    });
  });

  it('completed comes from the quest itself', () => {
    const state = only(buildPrereqState([q2], lookup, done));
    expect([state.completed, state.completedSource]).toEqual([true, 'addon']);
  });
});

describe('countNeeded', () => {
  it('sums neededCount across states', () => {
    const states = [
      {
        questId: 1,
        steps: [],
        neededCount: 2,
        completed: false,
        completedSource: null,
      },
      {
        questId: 2,
        steps: [],
        neededCount: 3,
        completed: false,
        completedSource: null,
      },
    ];
    expect(countNeeded(states)).toBe(5);
  });
});
