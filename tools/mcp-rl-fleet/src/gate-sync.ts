// ROK-2205 review M1 — the dispatch-time sync check behind the pre-push sentinel.
//
// rl_validate_ci runs on the runner's Mutagen-synced /workspace. On 2026-11-15
// a gate reported every row PASS while that tree was an old main commit, and
// nothing in a validate-ci task status could say so. This runs the EXISTING
// stale-build sync guard (sync-guard.ts, the one rl_env_deploy uses) at
// dispatch; validate-ci records the verdict next to the task's sha, and the
// terminal read (gate-verified.ts) refuses the sentinel when it is not ok.
//
// ROK-2205 Codex P2: the dispatch runs inside one ≤120s MCP call, so the gate
// asks the guard for a CHECK-ONLY probe (never the ~150s force-resync) and
// stops waiting after GATE_SYNC_BUDGET_MS. A mismatch, failure or timeout is
// recorded as not verified; the agent runs rl_force_resync and re-dispatches.

import { ensureSyncedHead, type SyncGuardResult } from './sync-guard.js';
import type { GateSyncRecord } from './gate-verified.js';

/** Hard aggregate budget for the whole gate preflight (well under the 120s cap). */
export const GATE_SYNC_BUDGET_MS = 20_000;

/** Per-flush timeout so a probe abandoned by the budget winds down soon after. */
const GATE_FLUSH_TIMEOUT_MS = 8_000;

/** Plain-English reason for a failed guard, kept short for the sha map. */
function failureReason(guard: SyncGuardResult): string {
  return guard.error === 'probe_failed'
    ? 'the sync probe could not run'
    : 'Mutagen sync unverified — /workspace did not match the worktree HEAD (check-only probe, no force-resync attempted)';
}

/**
 * Reduce a sync guard result to the record stored for the task.
 *
 * @param guard - The guard's result.
 * @returns The record `gateVerifiedVeto` reads at the terminal status.
 */
export function syncRecordFrom(guard: SyncGuardResult): GateSyncRecord {
  return {
    ok: guard.ok,
    expected_head: guard.expected_head,
    synced_head: guard.synced_head,
    ...(guard.ok ? {} : { message: failureReason(guard) }),
  };
}

/**
 * Race a guard run against the budget. On timeout the outstanding probe is
 * ignored (its own flush timeouts and sentinel cleanup still bound it).
 */
async function withinBudget(run: Promise<GateSyncRecord>, budgetMs: number): Promise<GateSyncRecord> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<GateSyncRecord>((resolve) => {
    timer = setTimeout(() => resolve({
      ok: false,
      expected_head: null,
      synced_head: null,
      message: `the sync check timed out after ${Math.round(budgetMs / 1000)}s, so the runner tree is unverified`,
    }), budgetMs);
  });
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the claimed slot's /workspace reflects the worktree HEAD before a
 * validate-ci dispatch — check-only, inside GATE_SYNC_BUDGET_MS. Never throws;
 * no slot means the sync cannot be verified, which is recorded as not ok.
 *
 * @param slot - The claimed slot, or null when none resolved.
 * @param worktreePath - The caller's worktree (Mutagen alpha).
 * @returns The record to store with the task's sha.
 */
export async function verifyGateSync(
  slot: number | null,
  worktreePath?: string,
): Promise<GateSyncRecord> {
  if (slot === null) {
    return {
      ok: false,
      expected_head: null,
      synced_head: null,
      message: 'no claimed slot resolved, so the runner sync could not be verified',
    };
  }
  const run = ensureSyncedHead({
    slot,
    worktree_path: worktreePath,
    check_only: true,
    flush_timeout_ms: GATE_FLUSH_TIMEOUT_MS,
  }).then(syncRecordFrom);
  return withinBudget(run, GATE_SYNC_BUDGET_MS);
}
