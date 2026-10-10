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
  /** CONTRACT §char: above the cap only the LOWEST ids ascending are sent. */
  completedTruncated?: boolean | undefined;
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

/**
 * Done state of one quest for one viewer (D12). `unknown` marks a quest the
 * data cannot speak to: no row, and its id sits above a truncated snapshot's
 * highest sent id (ROK-1758) — it is shown not-done but never counted needed.
 */
export interface QuestDoneState {
  done: boolean;
  source: QuestProgressSource | null;
  unknown: boolean;
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

/**
 * Highest completed id of a truncated snapshot (ROK-1758). The addon keeps the
 * lowest ids when it truncates, so anything above this is unknown, not undone.
 * @returns undefined when the list is complete (or empty).
 */
export function truncationCutoff(quests: {
  completed: number[];
  completedTruncated?: boolean | undefined;
}): number | undefined {
  if (!quests.completedTruncated || quests.completed.length === 0) {
    return undefined;
  }
  return quests.completed.reduce((max, id) => (id > max ? id : max));
}

/**
 * Build a D12 done lookup from ONE viewer's merged rows. With a `cutoff`
 * (see {@link truncationCutoff}) a row-less id above it is `unknown`.
 */
export function doneLookupFromRows(
  rows: MergedProgressRow[],
  cutoff?: number,
): QuestDoneFn {
  const byQuest = new Map(rows.map((r) => [r.questId, r]));
  return (questId) => {
    const row = byQuest.get(questId);
    if (row) return { done: row.completed, source: row.source, unknown: false };
    const unknown = cutoff !== undefined && questId > cutoff;
    return { done: false, source: null, unknown };
  };
}

/** Restriction fields of a quest (the web's `isQuestUsable` reads the same). */
type QuestRestrictions = Pick<
  DungeonQuestDto,
  'classRestriction' | 'raceRestriction'
>;

/** True when `value` passes a restriction list (empty list / value = no limit). */
function passes(list: string[] | null, value: string | null): boolean {
  if (!list || list.length === 0 || !value) return true;
  const wanted = value.toLowerCase();
  return list.some((entry) => entry.toLowerCase() === wanted);
}

/**
 * Whether a character of this class/race can take the quest. Mirrors
 * `web/src/plugins/wow/utils/quest-dedup.ts::isQuestUsable` (ROK-1758).
 */
export function isQuestUsableBy(
  quest: QuestRestrictions,
  charClass: string | null,
  charRace: string | null,
): boolean {
  return (
    passes(quest.classRestriction, charClass) &&
    passes(quest.raceRestriction, charRace)
  );
}

/** A step still to do: not done, and not unknown (ROK-1758). */
const isNeeded = (s: QuestDoneState): boolean => !s.done && !s.unknown;

/** Chain state for one quest: steps strictly before it in its chain. */
function prereqStateFor(
  quest: DungeonQuestDto,
  lookup: Map<number, DungeonQuestDto>,
  doneFn: QuestDoneFn,
): QuestPrereqState {
  const chain = walkChainInMemory(quest, lookup);
  const idx = chain.findIndex((q) => q.questId === quest.questId);
  const before = chain.slice(0, idx);
  const steps: QuestPrereqStep[] = before.map((q) => {
    const { done, source } = doneFn(q.questId);
    return { questId: q.questId, name: q.name, done, source };
  });
  const needed = before.filter((q) => isNeeded(doneFn(q.questId)));
  const self = doneFn(quest.questId);
  return {
    questId: quest.questId,
    steps,
    neededCount: needed.length,
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

/**
 * Distinct pre-req quests still needed across all states (`neededTotal`). A
 * step shared by several event quests counts once (ROK-1758); ids the caller
 * marks unknown are left out.
 */
export function countNeeded(
  states: QuestPrereqState[],
  isUnknown: (questId: number) => boolean = () => false,
): number {
  const ids = states.flatMap((s) =>
    s.steps.filter((st) => !st.done).map((st) => st.questId),
  );
  return new Set(ids.filter((id) => !isUnknown(id))).size;
}
