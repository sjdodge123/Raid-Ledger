// sync-guard — verify the runner's Mutagen-synced /workspace actually
// reflects the laptop's current HEAD before an allinone image is built.
//
// WHY THIS EXISTS (TECH-DEBT 2026-06-02 — "rl_env_deploy served stale build"):
//
//   build-image-on-runner builds from the file CONTENTS of /workspace, which
//   are populated by Mutagen's one-way-replica from the laptop working tree.
//   When that sync session wedges (halted/errored after rapid history-
//   rewriting rebases, or a duplicate-session race), the laptop-side
//   `flush_mutagen` SWALLOWS the error (`mutagen sync flush ... 2>/dev/null
//   || true`) — so the build reads STALE files yet build_image reports
//   success. The deployed env then serves pre-change code while every signal
//   says "green", producing false-negative Chrome-MCP verification.
//
//   The `worktree_head` field in rl_status is NOT a reliable guard here: it
//   reads a SEPARATE runner-side `.git` scaffold built via `git fetch origin
//   <branch>` (Mutagen excludes `.git` entirely — Bug R). After an UNPUSHED
//   local rebase the scaffold can't even see the new SHA, so comparing it to
//   the laptop HEAD would false-positive on the common unpushed-branch case.
//
//   The faithful signal of "what code is in /workspace" therefore has to come
//   from the synced FILES themselves. This guard writes a per-call sentinel
//   into the worktree, does a CHECKED flush, then reads the sentinel back out
//   of /workspace through the runner. If the exact token we just wrote comes
//   back, the sync pipeline is live and drained and the build will see current
//   source. If it doesn't, the session is wedged — we force a resync (terminate
//   + recreate + flush + re-scaffold) and re-probe; if it STILL doesn't match,
//   we fail loud so the caller never builds stale source.

import { randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { execFileP, runRl, parseJsonFromStdout } from './exec.js';
import * as runOnRunner from './tools/run-on-runner.js';

/**
 * Sentinel filename PREFIX written at the worktree root (and synced into
 * /workspace). Each guard call appends a random suffix so concurrent deploys
 * that (mis)share one worktree can't clobber or delete each other's marker
 * (Codex review 2026-06-02, med). Gitignored via `.rl-sync-probe-*`.
 */
export const SENTINEL_PREFIX = '.rl-sync-probe-';

export interface EnsureSyncedHeadParams {
  /** Slot the agent currently holds (used to name the Mutagen session `rl-slot-N`). */
  slot: number;
  /** Absolute worktree path (Mutagen alpha source). Defaults to process.cwd(). */
  worktree_path?: string;
  /** Per-probe flush timeout (ms). Default 30000. */
  flush_timeout_ms?: number;
  /** Timeout (ms) for the `rl resync` recovery child process. Default 150000. */
  resync_timeout_ms?: number;
}

export interface SyncGuardResult {
  ok: boolean;
  /** Laptop HEAD the build INTENDS to use (`git rev-parse HEAD`). null when not a git worktree. */
  expected_head: string | null;
  /** HEAD confirmed present in /workspace via the sentinel round-trip. Equals expected_head on success. */
  synced_head: string | null;
  /** True when the guard force-recreated the Mutagen session to recover. */
  resynced: boolean;
  /** Number of sentinel probes performed (1 = matched first try; 2 = needed a resync). */
  attempts: number;
  /**
   * Whether the LAST `mutagen sync flush` returned cleanly (false ⇒ session
   * halted/missing). A probe is only accepted when BOTH the sentinel matches
   * AND this is true — a sentinel that landed before the session halted must
   * NOT authorize a build while other source edits stayed un-applied (Codex
   * review 2026-06-02, high).
   */
  flush_ok: boolean;
  /** True when the guard was skipped (non-git worktree) — never blocks non-git use. */
  skipped?: boolean;
  /** Machine-readable failure code when ok=false. */
  error?: 'sync_stuck' | 'probe_failed';
  /** Human-readable summary. */
  message: string;
  /** Diagnostic — what the runner actually returned for the sentinel on the final probe. */
  detail?: string;
}

interface ProbeOutcome {
  /** Sentinel read back from /workspace equals the token we just wrote. */
  matched: boolean;
  /** `mutagen sync flush` returned cleanly. */
  flushOk: boolean;
  /** A probe is trustworthy only when the content matched AND the flush succeeded. */
  good: boolean;
  read: string;
  flushErr?: string;
}

/**
 * One end-to-end sync probe: write a fresh sentinel token into the worktree,
 * flush Mutagen (CHECKED — we do NOT swallow the error the way flush_mutagen
 * does), then read the sentinel back out of /workspace through the runner.
 * A probe is GOOD only when the brand-new laptop write reached /workspace AND
 * the flush reported in-sync (so no other source edit is stranded behind a
 * halted session).
 */
async function probeOnce(
  sentinelName: string,
  sentinelPath: string,
  token: string,
  slot: number,
  worktreePath: string | undefined,
  flushTimeoutMs: number,
): Promise<ProbeOutcome> {
  await writeFile(sentinelPath, `${token}\n`, 'utf8');

  let flushOk = true;
  let flushErr: string | undefined;
  try {
    await execFileP('mutagen', ['sync', 'flush', `rl-slot-${slot}`], {
      timeout: flushTimeoutMs,
    });
  } catch (err) {
    // A halted/missing session makes `mutagen sync flush` exit non-zero.
    // Unlike the CLI's best-effort flush_mutagen, we RECORD this — it's the
    // primary tell that the session is wedged. We still attempt the read for
    // diagnostics, but a failed flush can NEVER produce a `good` probe.
    flushOk = false;
    flushErr = (err as Error & { stderr?: string }).stderr || (err as Error).message;
  }

  // sentinelName is `.rl-sync-probe-<hex>` (hex only) — safe to interpolate;
  // run-on-runner single-quotes the whole command at the SSH boundary anyway.
  const ror = await runOnRunner.execute({
    command: `cat ${sentinelName} 2>/dev/null || true`,
    worktree_path: worktreePath,
  });
  const read = (ror.stdout ?? '').trim();
  const matched = read === token;
  return { matched, flushOk, good: matched && flushOk, read, flushErr };
}

function makeToken(head: string): string {
  // head pins the token to the build we intend; the time+nonce suffix makes
  // every probe unique so a STALE sentinel left in /workspace by a previous
  // deploy of the same HEAD can never masquerade as a fresh, current sync.
  return `${head}:${Date.now().toString(36)}:${randomBytes(6).toString('hex')}`;
}

/**
 * Ensure the runner's /workspace reflects the laptop's current HEAD before a
 * build. Probes once; on mismatch, force-resyncs the Mutagen session via
 * `rl resync` and probes again. Returns a structured result the caller surfaces
 * and gates the build on. Never throws — all failure modes map to ok=false.
 *
 * Non-git worktrees (no HEAD to compare) are SKIPPED with ok=true so this never
 * blocks legitimate non-git use of the fleet.
 */
export async function ensureSyncedHead(
  params: EnsureSyncedHeadParams,
): Promise<SyncGuardResult> {
  const worktreePath = params.worktree_path;
  const dir = worktreePath ?? process.cwd();
  const flushTimeoutMs = params.flush_timeout_ms ?? 30_000;
  const resyncTimeoutMs = params.resync_timeout_ms ?? 150_000;

  // Laptop HEAD — the SHA the build intends to use.
  let expected: string;
  try {
    const { stdout } = await execFileP('git', ['-C', dir, 'rev-parse', 'HEAD']);
    expected = stdout.trim();
  } catch {
    return {
      ok: true,
      skipped: true,
      expected_head: null,
      synced_head: null,
      resynced: false,
      attempts: 0,
      flush_ok: true,
      message: `Sync guard skipped — ${dir} is not a git worktree (no HEAD to verify).`,
    };
  }
  if (!expected) {
    return {
      ok: true,
      skipped: true,
      expected_head: null,
      synced_head: null,
      resynced: false,
      attempts: 0,
      flush_ok: true,
      message: 'Sync guard skipped — git rev-parse HEAD returned empty.',
    };
  }

  // Per-call sentinel name so overlapping guard runs never clobber each other.
  const sentinelName = `${SENTINEL_PREFIX}${randomBytes(8).toString('hex')}`;
  const sentinelPath = join(dir, sentinelName);
  let attempts = 0;
  let resynced = false;
  let last: ProbeOutcome | undefined;

  try {
    for (let i = 0; i < 2; i++) {
      attempts++;
      last = await probeOnce(
        sentinelName,
        sentinelPath,
        makeToken(expected),
        params.slot,
        worktreePath,
        flushTimeoutMs,
      );
      // GOOD requires BOTH a content match AND a clean flush — a matched
      // sentinel behind a halted flush must not authorize a build.
      if (last.good) {
        return {
          ok: true,
          expected_head: expected,
          synced_head: expected,
          resynced,
          attempts,
          flush_ok: last.flushOk,
          message: resynced
            ? `Mutagen sync was wedged — force-resynced; /workspace now matches laptop HEAD ${short(expected)}.`
            : `/workspace verified in sync with laptop HEAD ${short(expected)}.`,
        };
      }
      // Not good (stale content OR failed flush) — recover with a forced,
      // time-bounded resync, then probe once more.
      if (i === 0) {
        try {
          const { stdout } = await runRl(['resync'], {
            cwd: worktreePath,
            timeoutMs: resyncTimeoutMs,
          });
          parseJsonFromStdout(stdout); // best-effort parse; failure is non-fatal
        } catch {
          /* fall through to second probe — it will fail loud if still stale */
        }
        resynced = true;
      }
    }
  } catch (err) {
    // Contract: ensureSyncedHead never throws — an unexpected failure (e.g.
    // the sentinel write to the worktree failing) maps to a loud, safe
    // "couldn't verify ⇒ don't build" result rather than crashing the deploy.
    // (The `finally` below still unlinks the sentinel.)
    return {
      ok: false,
      error: 'probe_failed',
      expected_head: expected,
      synced_head: null,
      resynced,
      attempts,
      flush_ok: last?.flushOk ?? false,
      detail: (err as Error).message,
      message:
        `Sync guard could not verify /workspace against laptop HEAD ${short(expected)} ` +
        `(${(err as Error).message}). Refusing to build. Retry, or recover with rl_force_resync.`,
    };
  } finally {
    // Don't leave the sentinel lingering in the worktree (it's gitignored, but
    // tidy is better). The runner-side copy is harmless and gets overwritten /
    // re-synced next round.
    await unlink(sentinelPath).catch(() => {});
  }

  // Still not good after a resync — fail loud. The caller MUST NOT build.
  const detail = last
    ? `flush_ok=${last.flushOk}; matched=${last.matched}; runner returned ${JSON.stringify(last.read).slice(0, 200)}${last.flushErr ? `; flush_err=${last.flushErr.slice(0, 200)}` : ''}`
    : 'no probe completed';
  // Distinguish the two failure modes so the operator knows where to look.
  const reason =
    last && last.matched && !last.flushOk
      ? `the sentinel matched but 'mutagen sync flush' kept failing (session halted — other source edits may not be applied)`
      : `/workspace did not reflect laptop HEAD ${short(expected)}`;
  return {
    ok: false,
    error: 'sync_stuck',
    expected_head: expected,
    synced_head: null,
    resynced,
    attempts,
    flush_ok: last?.flushOk ?? false,
    detail,
    message:
      `Sync STUCK: ${reason}, and a force-resync did NOT recover it. ` +
      `Refusing to build (would serve pre-change or partially-synced code). Recover manually: run ` +
      `rl_force_resync (or 'rl resync' from the worktree), confirm 'mutagen sync list rl-slot-${params.slot}' ` +
      `shows the session Watching with no errors, then re-run rl_env_deploy. If it persists, release + re-claim the slot.`,
  };
}

function short(sha: string): string {
  return sha.slice(0, 7);
}
