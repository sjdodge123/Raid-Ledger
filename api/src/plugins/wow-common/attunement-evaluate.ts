import type {
  WowAttunementNoDataReason,
  WowAttunementResultDto,
} from '@raid-ledger/contract';
import {
  attunementQuestSteps,
  finalAttunementQuest,
  type AttunementDef,
  type AttunementQuestStep,
} from './data/forever-attunements';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import { truncationCutoff } from './quest-progress-addon.helpers';

/**
 * ROK-1927 — the per-character attunement step evaluator shared by the
 * roster section (guild widget) and the character page's own view. Pure:
 * the static dataset, the quest ids Blizzard confirmed and one character's
 * effective quests in; verdicts, step labels and done flags out.
 *
 * Lead call 2026-11-12 (ruling B per id): a def whose FINAL required quest is
 * unconfirmed is hidden; an unconfirmed intermediate step is dropped from the
 * checklist, the step count and the in-progress test. Completing the final
 * quest alone = attuned (ruling Q3).
 */

export type AttunementFactionSide = 'horde' | 'alliance';

/** A def as shown: its confirmed quest steps and level gate. */
export interface VisibleDef {
  def: AttunementDef;
  steps: AttunementQuestStep[];
  final: AttunementQuestStep | null;
  minLevel: number | null;
}

/** A verdict without the per-def key and level annotations. */
export type AttunementVerdict = Omit<
  WowAttunementResultDto,
  'key' | 'belowLevel' | 'requiredLevel'
>;

const HORDE_RACES = new Set([
  'orc',
  'undead',
  'scourge',
  'tauren',
  'troll',
  'blood elf',
  'bloodelf',
]);
const ALLIANCE_RACES = new Set([
  'human',
  'dwarf',
  'night elf',
  'nightelf',
  'gnome',
  'draenei',
]);

/** A race (display name or addon token) → its faction; unknown → null. */
export function factionOfRace(
  race: string | null | undefined,
): AttunementFactionSide | null {
  const key = race?.trim().toLowerCase() ?? '';
  if (HORDE_RACES.has(key)) return 'horde';
  if (ALLIANCE_RACES.has(key)) return 'alliance';
  return null;
}

/** The defs to show; hidden = trackable with an unconfirmed final quest. */
export function visibleDefs(
  defs: readonly AttunementDef[],
  confirmed: ReadonlySet<number>,
): VisibleDef[] {
  return defs.flatMap<VisibleDef>((def) => {
    const levelStep = def.steps.find((s) => s.kind === 'level');
    const minLevel = levelStep?.kind === 'level' ? levelStep.min : null;
    if (!def.trackable) return [{ def, steps: [], final: null, minLevel }];
    const final = finalAttunementQuest(def);
    if (!final || !confirmed.has(final.questId)) return [];
    const steps = attunementQuestSteps(def).filter((s) =>
      confirmed.has(s.questId),
    );
    return [{ def, steps, final, minLevel }];
  });
}

/** Whether a def applies to a character of `faction` (D7). */
export function appliesTo(
  def: AttunementDef,
  faction: AttunementFactionSide | null,
): boolean {
  return def.faction === 'both' || def.faction === faction;
}

/** Below the def's level step (unknown level → not below). */
export function isBelowLevel(v: VisibleDef, level: number | null): boolean {
  return v.minLevel !== null && level !== null && level < v.minLevel;
}

export function noDataVerdict(
  reason: WowAttunementNoDataReason,
): AttunementVerdict {
  return {
    state: 'no_data',
    noDataReason: reason,
    stepsDone: 0,
    nextStep: null,
  };
}

/** One character's verdict on one trackable, visible def. */
export function evaluateAttunement(
  v: VisibleDef,
  quests: EffectiveQuests | null,
): AttunementVerdict {
  if (quests === null || v.final === null)
    return noDataVerdict('no_quest_data');
  const { completed, inProgress } = quests.quests;
  const done = new Set(completed);
  if (done.has(v.final.questId))
    return {
      state: 'done',
      noDataReason: null,
      stepsDone: v.steps.length,
      nextStep: null,
    };
  const inLog = inProgress.some((q) =>
    v.steps.some((s) => s.questId === q.questId),
  );
  const cutoff = truncationCutoff(quests.quests);
  const unknown =
    cutoff !== undefined && v.steps.some((s) => s.questId > cutoff);
  if (unknown && !inLog) return noDataVerdict('truncated');
  const stepsDone = v.steps.filter((s) => done.has(s.questId)).length;
  const next = v.steps.find((s) => !done.has(s.questId));
  return {
    state: inLog || stepsDone > 0 ? 'in_progress' : 'not_started',
    noDataReason: null,
    stepsDone,
    nextStep: next?.label ?? null,
  };
}

/**
 * The confirmed steps with done flags. Final quest completed → every step
 * done (ruling Q3: earlier steps may predate the quest list).
 */
export function attunementChecklist(
  v: VisibleDef,
  quests: EffectiveQuests | null,
): { label: string; done: boolean }[] {
  const done = new Set(quests?.quests.completed ?? []);
  const attuned = v.final !== null && done.has(v.final.questId);
  return v.steps.map((s) => ({
    label: s.label,
    done: attuned || done.has(s.questId),
  }));
}
