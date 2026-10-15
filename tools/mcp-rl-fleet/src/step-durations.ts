// ROK-1793 S0 — fill `steps[].duration_s` from validate-ci's `[step-time]` lines.
//
// `scripts/validate-ci.sh` `run_step` prints `[step-time] <name> <seconds>`
// just before each "<name>: <STATUS>" row. The orchestrator's task-start parser
// stamps it onto steps[] (rl-infra/orchestrator/bin/_parser.sh
// PATTERN_STEP_TIME), but only once the VM runs that orchestrator version. This
// is the laptop-side fallback: any step still `duration_s: null` takes the
// duration of a `[step-time]` line for the same name found in the log tail.
// A step with a duration already set is never overwritten, and a name with no
// line in the tail stays null (the tail may not reach back that far).

import type { z } from 'zod';
import type { TaskStepSchema } from './tools/task-schemas.js';

type TaskStep = z.infer<typeof TaskStepSchema>;

const STEP_TIME_RE = /^\[step-time\] (.+) (\d+(?:\.\d+)?)\s*$/gm;

/** name -> durations in log order (a name can repeat across reruns). */
export function parseStepTimes(logTail: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const m of logTail.matchAll(STEP_TIME_RE)) {
    const name = m[1];
    const secs = m[2];
    if (name === undefined || secs === undefined) continue;
    const list = out.get(name) ?? [];
    list.push(Number(secs));
    out.set(name, list);
  }
  return out;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * name -> durations whose "<name>: <STATUS>" row also appears later in the
 * tail. A `[step-time]` line printed just before the poll caught its row has
 * no steps[] entry yet, so counting it would shift every match by one.
 */
function confirmedStepTimes(logTail: string): Map<string, number[]> {
  const lines = logTail.replace(ANSI_RE, '').split('\n');
  const out = new Map<string, number[]>();
  lines.forEach((line, idx) => {
    const m = /^\[step-time\] (.+) (\d+(?:\.\d+)?)\s*$/.exec(line);
    const name = m?.[1];
    const secs = m?.[2];
    if (name === undefined || secs === undefined) return;
    const row = `${name}: `;
    if (!lines.slice(idx + 1).some((l) => l.startsWith(row))) return;
    const list = out.get(name) ?? [];
    list.push(Number(secs));
    out.set(name, list);
  });
  return out;
}

/**
 * Returns a copy of `steps` with null durations filled from `logTail`.
 *
 * Occurrences are matched in order, aligned from the END: steps[] comes from
 * the whole log but the tail may have lost the earliest `[step-time]` lines,
 * so the k-th-from-last timing of a name belongs to the k-th-from-last step
 * of that name. A step whose duration is already set still occupies its slot
 * (it is never overwritten, and it never shifts the steps around it).
 */
export function backfillStepDurations(
  steps: readonly TaskStep[],
  logTail: string | null | undefined,
): TaskStep[] {
  if (!logTail || !logTail.includes('[step-time] ')) return [...steps];
  const times = confirmedStepTimes(logTail);
  const remaining = new Map<string, number>();
  for (const step of steps) remaining.set(step.name, (remaining.get(step.name) ?? 0) + 1);
  return steps.map((step) => {
    const after = (remaining.get(step.name) ?? 1) - 1; // same-name steps after this one
    remaining.set(step.name, after);
    if (step.duration_s !== null) return step;
    const list = times.get(step.name) ?? [];
    const secs = list[list.length - 1 - after];
    return secs === undefined ? step : { ...step, duration_s: secs };
  });
}
