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

/** Returns a copy of `steps` with null durations filled from `logTail`. */
export function backfillStepDurations(
  steps: readonly TaskStep[],
  logTail: string | null | undefined,
): TaskStep[] {
  if (!logTail || !logTail.includes('[step-time] ')) return [...steps];
  const times = parseStepTimes(logTail);
  return steps.map((step) => {
    if (step.duration_s !== null) return step;
    const next = times.get(step.name)?.shift();
    return next === undefined ? step : { ...step, duration_s: next };
  });
}
