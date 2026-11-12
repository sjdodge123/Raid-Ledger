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

/** A stored faction column ("Horde", "alliance") → its side; else null. */
export function factionOfColumn(
  faction: string | null | undefined,
): AttunementFactionSide | null {
  const key = faction?.trim().toLowerCase();
  return key === 'horde' || key === 'alliance' ? key : null;
}

/**
 * One character's completed-id Set and truncation cut-off, built ONCE per
 * character and shared by every def's verdict and checklist (review MINOR-3).
 */
export interface PreparedQuests {
  done: ReadonlySet<number>;
  cutoff: number | undefined;
}

export function prepareQuests(
  quests: EffectiveQuests | null,
): PreparedQuests | null {
  if (quests === null) return null;
  return {
    done: new Set(quests.quests.completed),
    cutoff: truncationCutoff(quests.quests),
  };
}

/** Whether a confirmed step of `v` sits in the character's quest log. */
export function stepInLog(
  v: VisibleDef,
  quests: EffectiveQuests | null,
): boolean {
  const log = quests?.quests.inProgress ?? [];
  return log.some((q) => v.steps.some((s) => s.questId === q.questId));
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

function doneVerdict(v: VisibleDef): AttunementVerdict {
  return {
    state: 'done',
    noDataReason: null,
    stepsDone: v.steps.length,
    nextStep: null,
  };
}

/** One character's verdict on one trackable, visible def. */
export function evaluateAttunement(
  v: VisibleDef,
  quests: EffectiveQuests | null,
  prepared: PreparedQuests | null = prepareQuests(quests),
): AttunementVerdict {
  if (quests === null || prepared === null || v.final === null)
    return noDataVerdict('no_quest_data');
  const { done, cutoff } = prepared;
  if (done.has(v.final.questId)) return doneVerdict(v);
  const inLog = stepInLog(v, quests);
  const unknown =
    cutoff !== undefined && v.steps.some((s) => s.questId > cutoff);
  if (unknown && !inLog) return noDataVerdict('truncated');
  const stepsDone = v.steps.filter((s) => done.has(s.questId)).length;
  const next =
    loggedStep(v, quests, done) ?? v.steps.find((s) => !done.has(s.questId));
  return {
    state: inLog || stepsDone > 0 ? 'in_progress' : 'not_started',
    noDataReason: null,
    stepsDone,
    nextStep: next?.label ?? null,
  };
}

/**
 * The furthest not-done step that sits in the quest log (Codex P2): a log
 * holding a later step proves the earlier ones are behind the character even
 * when the completed list does not show them, so that step is the next one.
 */
function loggedStep(
  v: VisibleDef,
  quests: EffectiveQuests,
  done: ReadonlySet<number>,
): AttunementQuestStep | undefined {
  const log = new Set(quests.quests.inProgress.map((q) => q.questId));
  let found: AttunementQuestStep | undefined;
  for (const s of v.steps)
    if (log.has(s.questId) && !done.has(s.questId)) found = s;
  return found;
}

/**
 * The confirmed steps with done flags. Final quest completed → every step
 * done (ruling Q3: earlier steps may predate the quest list).
 */
export function attunementChecklist(
  v: VisibleDef,
  quests: EffectiveQuests | null,
  prepared: PreparedQuests | null = prepareQuests(quests),
): { label: string; done: boolean }[] {
  const done = prepared?.done ?? new Set<number>();
  const attuned = v.final !== null && done.has(v.final.questId);
  return v.steps.map((s) => ({
    label: s.label,
    done: attuned || done.has(s.questId),
  }));
}
