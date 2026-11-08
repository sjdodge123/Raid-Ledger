/**
 * ROK-2125: an import whose `quests` has no `completed` key must not wipe the
 * completed list already stored — the stored list (and its truncation flag)
 * is carried into the new snapshot. An explicit list, empty included, is
 * written as sent.
 */
import type { AddonCharSnapshotData } from '@raid-ledger/contract';
import { carryStoredCompletedQuests } from './addon-import-char.quests-carry';

const LOG = [{ questId: 9 }];

function incoming(
  quests: AddonCharSnapshotData['quests'],
): AddonCharSnapshotData {
  const base: AddonCharSnapshotData = {
    gear: [],
    talents: { nodes: [] },
    lockouts: [],
  };
  return quests ? { ...base, quests } : base;
}

const stored = (completed: number[], truncated = false) => ({
  quests: {
    completed,
    ...(truncated ? { completedTruncated: true } : {}),
    inProgress: [],
  },
});

describe('carryStoredCompletedQuests (ROK-2125)', () => {
  it('carries the stored list + truncation flag into a log-only import', () => {
    const out = carryStoredCompletedQuests(
      incoming({ inProgress: LOG }),
      stored([1, 2], true),
    );
    expect(out.quests).toEqual({
      completed: [1, 2],
      completedTruncated: true,
      inProgress: LOG,
    });
  });

  it('leaves a log-only import as sent when nothing usable is stored', () => {
    for (const s of [
      undefined,
      null,
      { gear: [] },
      { quests: { completed: 'x' } },
      { quests: { inProgress: [] } },
    ]) {
      const data = incoming({ inProgress: LOG });
      expect(carryStoredCompletedQuests(data, s)).toBe(data);
    }
  });

  it('writes an explicit list as sent — an empty list included', () => {
    for (const completed of [[], [7]]) {
      const data = incoming({ completed, inProgress: LOG });
      expect(carryStoredCompletedQuests(data, stored([1, 2]))).toBe(data);
    }
  });

  it('writes an import with no quests slice at all as sent', () => {
    const data = incoming(undefined);
    expect(carryStoredCompletedQuests(data, stored([1, 2]))).toBe(data);
  });
});
