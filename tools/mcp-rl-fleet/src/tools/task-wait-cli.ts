#!/usr/bin/env tsx
// ROK-1567 — `rl-task-wait`: a bash-reachable wait on a fleet task.
//
// WHY A CLI AND NOT A TOOL: every MCP wait caps at 120s (ROK-1362), so waiting
// out a 20-minute validate-ci costs ~10 polls, each of which round-trips a task
// payload through the agent's context. A Bash call run with run_in_background
// costs ONE tool call: the agent is re-invoked when the process exits, and the
// only thing that lands in context is the handful of lines printed below.
//
// STDOUT CONTRACT (bash-parseable, deliberately narrow):
//   [HH:MMZ] <task_id> <status> <current_step>     — one per current_step CHANGE
//   PASS|FAIL|CANCELLED <id> — <name:STATUS,…> — sentinel=<path|none>
//   TIMEOUT <id> — <steps> — still <status> after <n>s
// EXIT: 0 = PASS, 1 = FAIL/CANCELLED, 2 = timeout or bad usage.
//
// Works for VM ids and laptop `local-…` ids alike — it polls executeStatus,
// which already routes both.

import { executeStatus } from './task.js';
import { TASK_ID_RE } from './task-schemas.js';

const DEFAULT_INTERVAL_S = 30;
const DEFAULT_TIMEOUT_S = 3600;
const USAGE = 'usage: rl-task-wait <task_id> [--timeout SECONDS] [--interval SECONDS]';
/** Flags that consume the NEXT argv entry — so `--timeout 60 <id>` finds the id. */
const VALUE_FLAGS = new Set(['--timeout', '--interval']);
/** Consecutive unreadable polls tolerated before giving up (review MAJOR 1). A
 *  transient SSH blip must not be reported as a task failure. */
const MAX_READ_ERRORS = 5;

/** Injection seams so the spec can drive the poll loop without real time. */
export interface TaskWaitDeps {
  status?: (p: { task_id: string; brief: boolean }) => Promise<Record<string, unknown>>;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

interface ParsedArgs {
  taskId: string;
  timeoutS: number;
  intervalS: number;
}

/** Parse `<task_id> [--timeout S] [--interval S]`, in any order. Null on bad usage. */
function parseArgs(argv: string[]): ParsedArgs | null {
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (VALUE_FLAGS.has(a)) i++; // skip the flag's value, it is not the id
      continue;
    }
    positional.push(a);
  }
  const taskId = positional[0];
  if (!taskId || !TASK_ID_RE.test(taskId)) return null;
  const read = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    if (i === -1) return fallback;
    const n = Number(argv[i + 1]);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    taskId,
    timeoutS: read('--timeout', DEFAULT_TIMEOUT_S),
    intervalS: read('--interval', DEFAULT_INTERVAL_S),
  };
}

/** `[HH:MMZ]` — UTC, minute resolution. Poll lines are progress, not forensics. */
function stamp(now: Date): string {
  return `[${now.toISOString().slice(11, 16)}Z]`;
}

/** Flatten steps[] to the `name:STATUS,…` summary the verdict line carries. */
function stepSummary(steps: unknown): string {
  if (!Array.isArray(steps)) return '';
  return steps
    .map((s) => (s ?? {}) as { name?: string; status?: string })
    // A malformed step renders as nothing rather than `undefined:undefined`.
    .filter((step) => typeof step.name === 'string' && typeof step.status === 'string')
    .map((step) => `${step.name}:${step.status}`)
    .join(',');
}

/** succeeded -> PASS, cancelled -> CANCELLED, anything else terminal -> FAIL. */
function verdict(status: string): 'PASS' | 'FAIL' | 'CANCELLED' {
  if (status === 'succeeded') return 'PASS';
  if (status === 'cancelled') return 'CANCELLED';
  return 'FAIL';
}

const NON_TERMINAL = new Set(['running', 'queued', 'waiting']);
/** The states the orchestrator actually reports as finished. Anything else —
 *  including the `{ok:false, error}` envelope a transient SSH failure returns —
 *  is a READ failure, not a verdict. */
const TERMINAL = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'killed_buffer_overflow',
  'killed_timeout',
]);

/**
 * Poll a task until it reaches a terminal state, printing one line per
 * `current_step` change and one verdict line at the end.
 *
 * @param argv CLI arguments after the script name.
 * @param deps Injection seams (status/log/sleep/now) — defaulted for real runs.
 * @returns The process exit code: 0 PASS, 1 FAIL/CANCELLED, 2 timeout/usage.
 */
export async function runTaskWait(argv: string[], deps: TaskWaitDeps = {}): Promise<number> {
  const log = deps.log ?? ((l: string) => process.stdout.write(`${l}\n`));
  const now = deps.now ?? (() => new Date());
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const status =
    deps.status ??
    ((p: { task_id: string; brief: boolean }) =>
      executeStatus(p) as Promise<unknown> as Promise<Record<string, unknown>>);

  const args = parseArgs(argv);
  if (!args) {
    log(USAGE);
    return 2;
  }

  // Elapsed is counted in INTERVALS, not off the wall clock: the loop's only
  // source of delay is `sleep`, so the two agree in production and the spec can
  // drive the whole timeout path with a no-op sleep (a wall-clock deadline plus
  // an instant sleep is an infinite loop).
  let waitedS = 0;
  let lastStep: string | null = null;
  let lastStatus = 'unknown';
  let readErrors = 0;
  let latest: Record<string, unknown> = {};

  for (;;) {
    latest = await status({ task_id: args.taskId, brief: true });
    const runtime = String(latest.mcp_runtime_status ?? latest.status ?? 'unknown');

    // A read we could not interpret is NOT a result. Keep polling; only give up
    // once it is persistent, and then say so — never print a verdict for a state
    // we did not observe (review MAJOR 1).
    if (latest.ok === false || (!TERMINAL.has(runtime) && !NON_TERMINAL.has(runtime))) {
      readErrors += 1;
      if (readErrors >= MAX_READ_ERRORS) {
        log(`READ-ERROR ${args.taskId} — ${String(latest.error ?? 'unreadable task status')}`);
        return 2;
      }
      await sleep(args.intervalS * 1000);
      waitedS += args.intervalS;
      continue;
    }
    readErrors = 0;
    lastStatus = runtime;
    const step = (latest.current_step as string | null) ?? null;
    if (step && step !== lastStep) {
      lastStep = step;
      log(`${stamp(now())} ${args.taskId} ${runtime} ${step}`);
    }
    if (!NON_TERMINAL.has(runtime)) {
      const sentinel = (latest.playwright_sentinel as string | null) || 'none';
      log(
        `${verdict(runtime)} ${args.taskId} — ${stepSummary(latest.steps)} — sentinel=${sentinel}`,
      );
      return verdict(runtime) === 'PASS' ? 0 : 1;
    }
    if (waitedS + args.intervalS > args.timeoutS) break;
    await sleep(args.intervalS * 1000);
    waitedS += args.intervalS;
  }

  log(
    `TIMEOUT ${args.taskId} — ${stepSummary(latest.steps)} — still ${lastStatus} after ` +
      `${waitedS}s (re-run rl-task-wait ${args.taskId} to keep waiting)`,
  );
  return 2;
}

// Only self-execute when invoked as a binary — importing this module (the spec,
// or any future caller) must not start a poll loop.
const entry = process.argv[1] ?? '';
if (/task-wait-cli\.(ts|js)$|rl-task-wait$/.test(entry)) {
  void runTaskWait(process.argv.slice(2)).then((code) => process.exit(code));
}
