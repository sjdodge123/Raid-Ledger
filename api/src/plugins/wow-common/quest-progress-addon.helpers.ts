/**
 * ROK-1748 L5b: pure helpers for addon-derived quest progress.
 *
 * - D6: LedgerLink snapshot quests → synthetic progress rows.
 * - D5: a manual row for (user, quest) wins BOTH fields; otherwise the addon.
 * - D12: per-viewer pre-req chain state (steps before the quest).
 *
 * No DB access — the service/query layer loads rows and calls these.
 */
import type {
  QuestPrereqState,
  QuestPrereqStep,
  QuestProgressSource,
} from '@raid-ledger/contract';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { walkChainInMemory } from './dungeon-quests.helpers';

/** The `quests` slice of a schema-2 LedgerLink character snapshot. */
export interface AddonQuestsSlice {
  completed: number[];
  inProgress: Array<{ questId: number }>;
}

/** A character snapshot reduced to what progress derivation needs. */
export type AddonQuestSnapshot = {
  quests: AddonQuestsSlice;
  capturedAt: string;
};

/** Synthetic progress row derived from a snapshot (D6). */
export interface AddonProgressRow {
  userId: number;
  questId: number;
  characterId: string;
  pickedUp: boolean;
  completed: boolean;
  source: 'addon';
  asOf: string;
}

/** A persisted `wow_classic_quest_progress` row (manual tick). */
export interface ManualProgressRow extends Pick<
  AddonProgressRow,
  'userId' | 'questId' | 'pickedUp' | 'completed'
> {
  id: number;
  updatedAt: Date;
}

/** Effective progress after precedence; `id: 0` marks an addon row (D9). */
export interface MergedProgressRow extends Omit<
  AddonProgressRow,
  'source' | 'characterId'
> {
  id: number;
  source: QuestProgressSource;
  characterId: string | null;
}

/** Done state of one quest for one viewer (D12). */
export interface QuestDoneState {
  done: boolean;
  source: QuestProgressSource | null;
}

/** Resolves a quest id to the viewer's done state. */
export type QuestDoneFn = (questId: number) => QuestDoneState;

/**
 * Derive addon progress rows from a snapshot (D6). Only quests in
 * `knownQuestIds` are emitted; completed implies not picked up.
 */
export function deriveAddonProgress(
  snapshot: AddonQuestSnapshot,
  knownQuestIds: Set<number>,
  userId: number,
  characterId: string,
): AddonProgressRow[] {
  const completed = new Set(snapshot.quests.completed);
  const ids = [
    ...completed,
    ...snapshot.quests.inProgress.map((q) => q.questId),
  ];
  return [...new Set(ids)]
    .filter((questId) => knownQuestIds.has(questId))
    .map((questId) => ({
      userId,
      questId,
      characterId,
      pickedUp: !completed.has(questId),
      completed: completed.has(questId),
      source: 'addon' as const,
      asOf: snapshot.capturedAt,
    }));
}

/** Precedence key: one (user, quest) pair. */
const key = (u: number, q: number): string => `${u}:${q}`;

/**
 * Apply D5 precedence: per (userId, questId) a manual row wins both fields;
 * addon rows fill everything else. Manual rows first, then addon rows.
 */
export function mergeProgress(
  manualRows: ManualProgressRow[],
  addonRows: AddonProgressRow[],
): MergedProgressRow[] {
  const manualKeys = new Set(manualRows.map((r) => key(r.userId, r.questId)));
  const fromManual = manualRows.map((r) => ({
    id: r.id,
    userId: r.userId,
    questId: r.questId,
    pickedUp: r.pickedUp,
    completed: r.completed,
    source: 'manual' as const,
    asOf: r.updatedAt.toISOString(),
    characterId: null,
  }));
  const fromAddon = addonRows
    .filter((r) => !manualKeys.has(key(r.userId, r.questId)))
    .map((r) => ({ id: 0, ...r }));
  return [...fromManual, ...fromAddon];
}

/**
 * D5 insert rule: a new manual row copies each unspecified field from the
 * current addon state (or `false` when there is none).
 */
export function fillFromAddon(
  update: { pickedUp?: boolean; completed?: boolean },
  addonRow: Pick<AddonProgressRow, 'pickedUp' | 'completed'> | undefined,
): { pickedUp: boolean; completed: boolean } {
  return {
    pickedUp: update.pickedUp ?? addonRow?.pickedUp ?? false,
    completed: update.completed ?? addonRow?.completed ?? false,
  };
}

/** Build a D12 done lookup from ONE viewer's merged rows. */
export function doneLookupFromRows(rows: MergedProgressRow[]): QuestDoneFn {
  const byQuest = new Map(rows.map((r) => [r.questId, r]));
  return (questId) => {
    const row = byQuest.get(questId);
    return row
      ? { done: row.completed, source: row.source }
      : { done: false, source: null };
  };
}

/** Chain state for one quest: steps strictly before it in its chain. */
function prereqStateFor(
  quest: DungeonQuestDto,
  lookup: Map<number, DungeonQuestDto>,
  doneFn: QuestDoneFn,
): QuestPrereqState {
  const chain = walkChainInMemory(quest, lookup);
  const idx = chain.findIndex((q) => q.questId === quest.questId);
  const before = chain.slice(0, idx);
  const steps: QuestPrereqStep[] = before.map((q) => ({
    questId: q.questId,
    name: q.name,
    ...doneFn(q.questId),
  }));
  const self = doneFn(quest.questId);
  return {
    questId: quest.questId,
    steps,
    neededCount: steps.filter((s) => !s.done).length,
    completed: self.done,
    completedSource: self.source,
  };
}

/** Per-viewer pre-req chain state for each event quest (D12). */
export function buildPrereqState(
  quests: DungeonQuestDto[],
  lookup: Map<number, DungeonQuestDto>,
  doneFn: QuestDoneFn,
): QuestPrereqState[] {
  return quests.map((q) => prereqStateFor(q, lookup, doneFn));
}

/** Total pre-req steps still needed across all quests (`neededTotal`). */
export function countNeeded(states: QuestPrereqState[]): number {
  return states.reduce((sum, s) => sum + s.neededCount, 0);
}
