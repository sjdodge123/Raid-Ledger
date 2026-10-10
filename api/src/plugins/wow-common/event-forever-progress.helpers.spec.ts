import {
  buildMembers,
  contentInstanceIds,
  selectEventQuests,
} from './event-forever-progress.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

const quest = (
  questId: number,
  instance: number | null,
  prev: number | null = null,
): DungeonQuestDto =>
  ({
    questId,
    name: `Q${questId}`,
    dungeonInstanceId: instance,
    prevQuestId: prev,
    nextQuestId: null,
  }) as unknown as DungeonQuestDto;

describe('contentInstanceIds', () => {
  it('accepts numeric-string ids and the legacy instanceId key like the web panels', () => {
    expect(
      contentInstanceIds([{ id: '63' }, { instanceId: 36 }, { id: 'abc' }, { id: 0 }, { id: -1 }]),
    ).toEqual([63, 36]);
  });

  it('reads integer ids from [{id}] and ignores junk', () => {
    expect(contentInstanceIds([{ id: 63 }, { id: 'x' }, null, 5])).toEqual([
      63,
    ]);
  });

  it('returns [] for non-array content', () => {
    expect(contentInstanceIds(null)).toEqual([]);
    expect(contentInstanceIds({ id: 63 })).toEqual([]);
  });
});

describe('selectEventQuests', () => {
  it('keeps only the instance quests and bounds known ids to them + chains', () => {
    const known = [quest(1, null), quest(2, 63, 1), quest(3, 99), quest(4, 63)];
    const out = selectEventQuests(known, [63]);
    expect(out.eventQuests.map((q) => q.questId)).toEqual([2, 4]);
    expect([...out.knownIds].sort()).toEqual([1, 2, 4]);
  });
});

describe('buildMembers', () => {
  const signup = { userId: 1, username: 'u', characterId: 'c1' };
  const at = new Date('2026-10-01T00:00:00.000Z');

  it('drops characters without a snapshot or with a schema-1 (no quests) one', () => {
    const snaps = new Map([['c1', { data: { gear: [] }, capturedAt: at }]]);
    expect(buildMembers([signup], snaps as never)).toEqual([]);
    expect(buildMembers([signup], new Map())).toEqual([]);
  });

  it('keeps a character whose snapshot has a quests slice', () => {
    const data = { quests: { completed: [5], inProgress: [{ questId: 6 }] } };
    const snaps = new Map([['c1', { data, capturedAt: at }]]);
    const [m] = buildMembers([signup], snaps as never);
    expect(m?.snapshot.capturedAt).toBe(at.toISOString());
    expect(m?.snapshot.quests.completed).toEqual([5]);
  });
});
