import type { GameServerEffect } from '@raid-ledger/contract';

/** The task fields effect derivation reads (a subset of `PelicanTask`). */
export interface ScheduleTaskInput {
  id: number;
  sequence_id: number;
  action: string;
  payload: string | null;
  time_offset: number;
}

export interface DerivedEffect {
  effect: GameServerEffect;
  /** Seconds after the schedule fires that the deriving task runs. */
  effectOffsetS: number;
}

const POWER_KEYWORDS = ['start', 'restart', 'stop', 'kill'] as const;
type PowerKeyword = (typeof POWER_KEYWORDS)[number];

function isPowerKeyword(payload: string | null): payload is PowerKeyword {
  return POWER_KEYWORDS.some((k) => k === payload);
}

/** Actions that derive their own effect when they are the only kind present. */
const SINGLE_ACTION_EFFECTS: Readonly<Record<string, GameServerEffect>> = {
  backup: 'backup',
  command: 'command',
};

function bySequence(a: ScheduleTaskInput, b: ScheduleTaskInput): number {
  return a.sequence_id - b.sequence_id || a.id - b.id;
}

/** A power task with an unknown keyword is its own (unrecognised) action. */
function actionKey(task: ScheduleTaskInput): string {
  if (task.action !== 'power') return task.action;
  return isPowerKeyword(task.payload) ? `power:${task.payload}` : 'power:?';
}

/**
 * Pelican runs a schedule's tasks in `sequence_id` order, each one waiting
 * its own `time_offset` after the previous task — so a task fires at the
 * running sum of offsets through it (ROK-1773 Lead ruling Q1 / D9).
 */
function cumulativeOffsets(tasks: readonly ScheduleTaskInput[]): number[] {
  let sum = 0;
  return tasks.map((t) => (sum += t.time_offset));
}

/**
 * Collapse a schedule's tasks into the one effect it has on the server
 * (ROK-1773 §4). The first recognised power task wins; otherwise a lone
 * backup/command kind; anything else is `mixed`. No tasks → `null` (not
 * stored, D10). The payload is read only to match a power keyword and is
 * never returned.
 */
export function deriveScheduleEffect(
  tasks: readonly ScheduleTaskInput[],
): DerivedEffect | null {
  const ordered = [...tasks].sort(bySequence);
  const offsets = cumulativeOffsets(ordered);
  const firstOffset = offsets[0];
  if (firstOffset === undefined) return null;
  for (const [i, task] of ordered.entries()) {
    if (task.action === 'power' && isPowerKeyword(task.payload)) {
      return { effect: task.payload, effectOffsetS: offsets[i] ?? 0 };
    }
  }
  const kinds = new Set(ordered.map(actionKey));
  const [only] = kinds;
  const single =
    kinds.size === 1 && only ? SINGLE_ACTION_EFFECTS[only] : undefined;
  return { effect: single ?? 'mixed', effectOffsetS: firstOffset };
}
