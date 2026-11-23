/**
 * ROK-2212 (L7/L7b) — the shared-quest count's pure pieces.
 */
import type {
  EventQuestReadinessDto,
  QuestReadinessState,
  SuggestedGroupDto,
} from '@raid-ledger/contract';
import {
  applySharedQuests,
  claimedCharacterIds,
  countShared,
} from './suggested-groups.quests';

const uuid = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function readiness(
  states: Record<number, QuestReadinessState[]>,
): EventQuestReadinessDto {
  const questIds = Object.keys(states).map(Number);
  const width = Math.max(...questIds.map((q) => states[q]?.length ?? 0));
  return {
    quests: questIds.map((questId) => ({
      questId,
      title: `Q${questId}`,
      instanceId: 1,
    })),
    signups: Array.from({ length: width }, (_, i) => ({
      userId: i + 1,
      characterId: uuid(i + 1),
      name: `C${i + 1}`,
      perQuest: questIds.flatMap((questId) => {
        const state = states[questId]?.[i];
        return state
          ? [{ questId, state, prereqsMet: null, source: null }]
          : [];
      }),
    })),
  };
}

function group(claimed: (number | null)[], spread: number): SuggestedGroupDto {
  const roles = ['tank', 'healer', 'dps', 'dps', 'dps'] as const;
  return {
    instance: { id: 1, name: 'D', minimumLevel: 10, maximumLevel: 20 },
    members: claimed.map((n, i) => ({
      key: n === null ? `m${i + 10}` : uuid(n),
      characterId: n === null ? null : uuid(n),
      memberId: i + 10,
      userId: n,
      name: `N${i}`,
      class: null,
      level: 15,
      role: roles[i] ?? 'dps',
    })),
    levelSpread: spread,
    sharedQuests: null,
  };
}

describe('countShared', () => {
  it('counts a quest only when at least 3 members have or miss it', () => {
    const got = countShared(
      readiness({
        1: ['have', 'missing', 'missing'],
        2: ['have', 'missing', 'done'],
        3: ['unknown', 'missing', 'have', 'unknown'],
        4: ['missing', 'missing', 'have', 'have', 'done'],
      }),
    );
    expect(got).toBe(2);
  });
});

describe('claimedCharacterIds', () => {
  it('lists distinct claimed ids and never an unclaimed member', () => {
    const ids = claimedCharacterIds([
      group([1, 2, null, 3, null], 0),
      group([1, 4, null, null, null], 0),
    ]);
    expect(ids).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
  });
});

describe('applySharedQuests', () => {
  it('scores only the top n of a dungeon; the rest stay null', () => {
    const ctx = {
      known: [],
      guildFaction: 'Alliance',
      signups: new Map(),
      snapshots: new Map(),
    };
    const [ranked] = applySharedQuests(
      [[group([1, 2, 3, 4, 5], 0), group([1, 2, 3, 4, 6], 1)]],
      ctx,
      1,
    );
    expect(ranked?.map((g) => [g.levelSpread, g.sharedQuests])).toEqual([
      [0, 0],
      [1, null],
    ]);
  });
});
