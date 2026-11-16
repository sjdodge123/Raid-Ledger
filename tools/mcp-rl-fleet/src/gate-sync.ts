// ROK-2205 review M1 — the dispatch-time sync check behind the pre-push sentinel.
//
// rl_validate_ci runs on the runner's Mutagen-synced /workspace. On 2026-11-15
// a gate reported every row PASS while that tree was an old main commit, and
// nothing in a validate-ci task status could say so. This runs the EXISTING
// stale-build sync guard (sync-guard.ts, the one rl_env_deploy uses) at
// dispatch; validate-ci records the verdict next to the task's sha, and the
// terminal read (gate-verified.ts) refuses the sentinel when it is not ok.

import { ensureSyncedHead, type SyncGuardResult } from './sync-guard.js';
import type { GateSyncRecord } from './gate-verified.js';

/** Plain-English reason for a failed guard, kept short for the sha map. */
function failureReason(guard: SyncGuardResult): string {
  return guard.error === 'probe_failed'
    ? 'the sync probe could not run'
    : 'Mutagen sync stuck — /workspace did not match the worktree HEAD even after a force-resync';
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
 * Verify the claimed slot's /workspace reflects the worktree HEAD before a
 * validate-ci dispatch. Never throws; no slot means the sync cannot be
 * verified, which is recorded as not ok.
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
  return syncRecordFrom(await ensureSyncedHead({ slot, worktree_path: worktreePath }));
}
