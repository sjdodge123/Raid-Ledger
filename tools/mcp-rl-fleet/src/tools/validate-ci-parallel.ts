// ROK-1793 S2 — rl_validate_ci({fleet:true, parallel:true}): one gate, two runners.
//
// The parent task P is dispatched `--weight light` and runs the orchestrator's
// `gate-fanout`, which borrows a FREE second slot B, copies slot A's tree onto
// it and runs child A (`--fleet --no-e2e`, the static + unit + integration
// half) on A next to child B (`--only-e2e`, Playwright) on B, then merges both
// summaries into one table at the end of P's log. Slots with a live laptop
// Mutagen session are excluded (spec D2): a one-way replica would overwrite
// the copied tree mid-run.

import { shellQuote } from '../exec.js';
import { execFileP } from './runner-git.js';

/** The orchestrator entry point P runs on the VM host. */
export const GATE_FANOUT = '/srv/rl-infra/orchestrator/bin/gate-fanout';

/** Flags that narrow the gate so there is nothing to split across two runners. */
const UNSPLITTABLE_FLAGS = ['--static', '--no-e2e', '--only-e2e', '--only-unit', '--only-integration'];

/** The subset of rl_validate_ci params the parallel path reads. */
export interface ParallelParams {
  fleet?: boolean;
  parallel?: boolean;
  fail_fast?: boolean;
  args?: string[];
  e2e_scope?: 'auto' | 'all' | 'none';
}

/** What gate-fanout needs beyond the params: P's id, slot A, the resolved argv. */
export interface FanoutTarget {
  taskId: string;
  ownerSlot: number;
  /** validate-ci.sh argv after resolveArgs (contains --fleet). */
  args: string[];
  /** Watchdog budget for each child, in seconds (gate-fanout --child-timeout). */
  childTimeout: number;
}

/** Longest a phase-2 child C may wait for the fleet Discord lock before it runs. */
const DISCORD_LOCK_WAIT_S = 2700;
/** Admission waits and the tree copy, on P's clock. */
const PARENT_MARGIN_S = 600;
/** task-start's --timeout-seconds ceiling. */
const TASK_START_MAX_S = 86_400;

/**
 * P's watchdog budget. P outlives each child (admission waits, the tree copy,
 * and phase-2 child C run on its clock), so it must never be killed first.
 * Phase 1 (A next to B) is one child budget; when Discord smoke may run, C
 * then gets its own full budget plus the Discord-lock wait (Codex r1 P2).
 *
 * @param childTimeout - Each child's budget in seconds.
 * @param discordMayRun - Whether the inner env lets the Discord smoke run (C may be dispatched).
 * @returns The parent budget in seconds, capped at task-start's maximum.
 */
export function parallelParentTimeout(childTimeout: number, discordMayRun: boolean): number {
  const phase2 = discordMayRun ? childTimeout + DISCORD_LOCK_WAIT_S : 0;
  return Math.min(childTimeout + phase2 + PARENT_MARGIN_S, TASK_START_MAX_S);
}

/** Args that turn e2e on; child A is always --no-e2e, so they never reach it. */
const E2E_FORCING_FLAGS = ['--with-e2e', '--fleet-e2e'];

/** Child B / C argv: the e2e half, forced on as serial --fleet forces it. */
export const E2E_CHILD_ARGS = ['--only-e2e', '--fleet-e2e'];

/**
 * Why a `parallel:true` request cannot be honoured, or null when it can.
 *
 * @param params - The rl_validate_ci params.
 * @returns A refusal message, or null.
 */
export function parallelError(params: ParallelParams): string | null {
  if (!params.parallel) return params.fail_fast ? 'fail_fast needs parallel:true.' : null;
  if (params.fleet !== true) return 'parallel:true needs fleet:true — only the whole gate splits.';
  if (params.e2e_scope === 'none') return 'parallel:true with e2e_scope:"none" has no Playwright half to split.';
  const narrow = (params.args ?? []).find((a) => UNSPLITTABLE_FLAGS.includes(a));
  return narrow ? `parallel:true cannot split a ${narrow} run.` : null;
}

/**
 * Slot numbers that have an `rl-slot-N` session in `mutagen sync list` output.
 *
 * @param listing - Raw stdout of `mutagen sync list`.
 * @returns Sorted, de-duplicated slot numbers.
 */
export function parseBusySlots(listing: string): number[] {
  const slots = new Set<number>();
  for (const m of listing.matchAll(/^\s*Name:\s*rl-slot-(\d+)\s*$/gm)) {
    if (m[1] !== undefined) slots.add(Number(m[1]));
  }
  return [...slots].sort((a, b) => a - b);
}

/** Runs `mutagen sync list` and returns stdout; injectable for tests. */
export type MutagenLister = () => Promise<string>;

const defaultLister: MutagenLister = async () =>
  (await execFileP('mutagen', ['sync', 'list'], { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 })).stdout;

/**
 * Slots with a live laptop Mutagen session. A failed listing returns [] — the
 * orchestrator still refuses claimed/queued slots, and the ones this misses are
 * other agents' claimed slots, which borrow::try never takes anyway.
 *
 * @param lister - Override for tests.
 */
export async function busySlotsFromMutagen(lister: MutagenLister = defaultLister): Promise<number[]> {
  try {
    return parseBusySlots(await lister());
  } catch {
    return [];
  }
}

/**
 * The host command task P runs: gate-fanout with child A / B / serial argv.
 *
 * @param params - The rl_validate_ci params (reads fail_fast).
 * @param innerEnv - The `KEY=value ` prefix every child's validate-ci.sh gets.
 * @param busySlots - Slots to exclude from borrowing.
 * @param target - P's id, slot A and the resolved argv.
 */
export function buildFanoutCommand(
  params: ParallelParams,
  innerEnv: string,
  busySlots: number[],
  target: FanoutTarget,
): string {
  const rest = target.args.filter((a) => a !== '--fleet' && !E2E_FORCING_FLAGS.includes(a));
  const join = (argv: string[]): string => argv.map((a) => shellQuote(a)).join(' ');
  const parts = [
    GATE_FANOUT,
    shellQuote(target.taskId),
    `--owner-slot ${target.ownerSlot}`,
    `--exclude-slots ${shellQuote(busySlots.join(','))}`,
    `--inner-env ${shellQuote(innerEnv)}`,
    `--a-args ${shellQuote(join(['--fleet', '--no-e2e', ...rest]))}`,
    `--b-args ${shellQuote(join(E2E_CHILD_ARGS))}`,
    `--serial-args ${shellQuote(join(target.args))}`,
    `--child-timeout ${target.childTimeout}`,
  ];
  if (params.fail_fast === true) parts.push('--fail-fast');
  return parts.join(' ');
}

/**
 * validate-ci.ts's one-call seam: refuse, or build P's target command.
 *
 * @returns `{cmd}` to dispatch with `--weight light`, or `{error, message}`.
 */
export async function parallelTarget(
  params: ParallelParams,
  taskId: string,
  ownerSlot: number | null,
  innerEnv: string,
  args: string[],
  childTimeout: number,
  lister?: MutagenLister,
): Promise<{ cmd: string } | { error: string; message: string }> {
  const refusal = parallelError(params);
  if (refusal) return { error: 'invalid_parallel', message: refusal };
  if (ownerSlot === null) {
    return { error: 'parallel_requires_claim', message: 'parallel:true needs a claimed slot: rl_claim first (if it returns enqueued, rl_claim_wait until granted).' };
  }
  const busy = await busySlotsFromMutagen(lister);
  return { cmd: buildFanoutCommand(params, innerEnv, busy, { taskId, ownerSlot, args, childTimeout }) };
}
