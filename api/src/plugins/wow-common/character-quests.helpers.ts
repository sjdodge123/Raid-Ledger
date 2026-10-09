/**
 * ROK-1745: pure builders for the character-page quest section.
 * Intersects the addon snapshot's completed ids with the known dungeon-quest
 * table, groups by instance and marks chain steps done. The raw completed-id
 * list never reaches the output — only counts and the known overlap.
 */
import {
  CharacterQuestsDtoSchema,
  type CharacterCompletedQuest,
  type CharacterQuestInstanceGroup,
  type CharacterQuestLogEntry,
  type CharacterQuestsDto,
} from '@raid-ledger/contract';
import { walkChainInMemory } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

/** Quest log entry as the addon exports it (fields optional). */
interface ForeverQuestLogInput {
  questId: number;
  title?: string;
  objectives?: Array<{
    text: string;
    done: boolean;
    have?: number;
    need?: number;
  }>;
  dungeonInstanceId?: number;
}

/** Snapshot slice this builder reads; the 1742 snapshot schema maps onto it. */
export interface ForeverQuestSnapshotInput {
  capturedAt: string;
  quests?: {
    completed: number[];
    completedTruncated?: boolean;
    inProgress: ForeverQuestLogInput[];
  };
}

/** Map one addon quest-log entry onto the DTO shape with null/[] defaults. */
function toLogEntry(q: ForeverQuestLogInput): CharacterQuestLogEntry {
  return {
    questId: q.questId,
    title: q.title ?? null,
    objectives: (q.objectives ?? []).map((o) => ({
      text: o.text,
      done: o.done,
      have: o.have ?? null,
      need: o.need ?? null,
    })),
    dungeonInstanceId: q.dungeonInstanceId ?? null,
  };
}

/** Compare by level (nulls last), then name. */
function byLevelThenName(
  a: { level: number | null; name: string },
  b: { level: number | null; name: string },
): number {
  const la = a.level ?? Number.MAX_SAFE_INTEGER;
  const lb = b.level ?? Number.MAX_SAFE_INTEGER;
  return la - lb || a.name.localeCompare(b.name);
}

/** Build one completed quest with its chain steps marked done (D7). */
function toCompletedQuest(
  quest: DungeonQuestDto,
  lookup: Map<number, DungeonQuestDto>,
  completed: Set<number>,
): CharacterCompletedQuest {
  const chain = walkChainInMemory(quest, lookup).map((step) => ({
    questId: step.questId,
    name: step.name,
    done: step.questId === quest.questId || completed.has(step.questId),
  }));
  return {
    questId: quest.questId,
    name: quest.name,
    questLevel: quest.questLevel,
    chain,
  };
}

/** Bucket known quests by non-null dungeon instance id. */
function groupByInstance(
  known: DungeonQuestDto[],
): Map<number, DungeonQuestDto[]> {
  const groups = new Map<number, DungeonQuestDto[]>();
  for (const q of known) {
    if (q.dungeonInstanceId === null) continue;
    const list = groups.get(q.dungeonInstanceId) ?? [];
    list.push(q);
    groups.set(q.dungeonInstanceId, list);
  }
  return groups;
}

/** Build instance groups holding ≥1 completed quest (R-4), sorted per D8. */
function buildGroups(
  known: DungeonQuestDto[],
  completed: Set<number>,
  names: (id: number) => string,
): CharacterQuestInstanceGroup[] {
  const lookup = new Map(known.map((q) => [q.questId, q]));
  const groups: Array<
    CharacterQuestInstanceGroup & { minLevel: number | null }
  > = [];
  for (const [id, rows] of groupByInstance(known)) {
    const done = rows
      .filter((q) => completed.has(q.questId))
      .sort((a, b) =>
        byLevelThenName(
          { level: a.questLevel, name: a.name },
          { level: b.questLevel, name: b.name },
        ),
      )
      .map((q) => toCompletedQuest(q, lookup, completed));
    if (done.length === 0) continue;
    const levels = done
      .map((q) => q.questLevel)
      .filter((l): l is number => l !== null);
    const minLevel = levels.length ? Math.min(...levels) : null;
    groups.push({
      dungeonInstanceId: id,
      instanceName: names(id),
      completed: done,
      knownCount: rows.length,
      minLevel,
    });
  }
  groups.sort((a, b) =>
    byLevelThenName(
      { level: a.minLevel, name: a.instanceName },
      { level: b.minLevel, name: b.instanceName },
    ),
  );
  return groups.map(({ minLevel: _minLevel, ...g }) => g);
}

/**
 * Build the character quest section DTO, or `null` when the snapshot carries
 * no quest data (absent block, or both lists empty — R-6).
 */
export function buildCharacterQuests(
  snapshot: ForeverQuestSnapshotInput,
  knownQuests: DungeonQuestDto[],
  names: (id: number) => string,
): CharacterQuestsDto | null {
  const quests = snapshot.quests;
  if (
    !quests ||
    (quests.completed.length === 0 && quests.inProgress.length === 0)
  ) {
    return null;
  }
  const completed = new Set(quests.completed);
  const completedKnown = buildGroups(knownQuests, completed, names);
  const inProgress = quests.inProgress.map(toLogEntry);
  return CharacterQuestsDtoSchema.parse({
    source: 'addon',
    syncedAt: snapshot.capturedAt,
    inProgress,
    completedKnown,
    counts: {
      completedKnown: completedKnown.reduce(
        (n, g) => n + g.completed.length,
        0,
      ),
      knownTotal: knownQuests.length,
      completedTotal: quests.completed.length,
      inProgress: inProgress.length,
    },
  });
}
