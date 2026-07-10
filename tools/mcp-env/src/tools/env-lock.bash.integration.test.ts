import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// =============================================================================
// Bash-integration tests for scripts/env-lock.sh (ROK-1318)
// =============================================================================
// These tests shell out to the real bash script with an isolated state dir
// (RAID_LEDGER_STATE_DIR) so they cannot interfere with the operator's actual
// ~/.raid-ledger/env-lock.json. The TS unit tests cover wrapper shape; these
// cover the bash-level branching that the wrapper relies on.
// =============================================================================

// src/tools/<this-file> -> repo root is 4 levels up (../../../..)
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', '..', '..', 'scripts', 'env-lock.sh');

let stateDir: string;

function runScript(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      env: { ...process.env, RAID_LEDGER_STATE_DIR: stateDir },
      encoding: 'utf-8',
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      status: e.status ?? 1,
    };
  }
}

function parse<T>(out: string): T {
  return JSON.parse(out) as T;
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'env-lock-itest-'));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Scenario 1: agent_id primary match — release succeeds even if worktree drifts.
// This is the exact bug ROK-1318 fixes: deploy_dev.sh re-anchors PID under its
// own cwd, then MCP server later releases from a different cwd. Pre-fix, the
// branch+worktree-only predicate misses; post-fix, agent_id matches.
// ---------------------------------------------------------------------------
describe('agent_id primary match (ROK-1318)', () => {
  it('release succeeds via agent_id when worktree differs from holder.worktree', () => {
    const aid = 'abc123def4567890';
    // Acquire as if from the MCP server's cwd.
    const acquired = runScript([
      'acquire',
      'rok-1318',
      '/Users/x/wt-mcp',
      'mcp-acquire',
      '--ttl-minutes',
      '60',
      '--agent-id',
      aid,
    ]);
    expect(acquired.status).toBe(0);

    // Simulate deploy_dev.sh re-anchor — bare CLI, same branch+worktree, no agent-id.
    // Use the current test process PID so auto_expire's PID-liveness check passes;
    // a fake PID would be reaped on the next status read.
    const reanchored = runScript([
      'acquire',
      'rok-1318',
      '/Users/x/wt-mcp',
      'deploy_dev.sh (anchored to API PID)',
      '--pid',
      String(process.pid),
      '--ttl-minutes',
      '240',
    ]);
    expect(reanchored.status).toBe(0);

    // Holder's agent_id MUST be preserved across the re-anchor.
    const status = parse<{ holder: { agent_id: string; worktree: string } }>(
      runScript(['status']).stdout,
    );
    expect(status.holder.agent_id).toBe(aid);

    // Now release from a DIFFERENT worktree path — agent_id should match anyway.
    const released = parse<{ released: boolean; was_holder: boolean; matched_by: string | null }>(
      runScript([
        'release',
        'rok-1318',
        '/some/other/path',
        '--agent-id',
        aid,
      ]).stdout,
    );
    expect(released.released).toBe(true);
    expect(released.was_holder).toBe(true);
    expect(released.matched_by).toBe('agent_id');

    // Holder is null after release.
    const after = parse<{ holder: unknown }>(runScript(['status']).stdout);
    expect(after.holder).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: branch+worktree fallback — bare CLI release without --agent-id
// still works (operator's manual `./scripts/env-lock.sh release ...` shouldn't
// break).
// ---------------------------------------------------------------------------
describe('branch+worktree fallback (ROK-1318)', () => {
  it('release without --agent-id matches by branch+worktree', () => {
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'p',
      '--agent-id',
      'deadbeef00000000',
    ]);

    const released = parse<{ was_holder: boolean; matched_by: string | null }>(
      runScript(['release', 'rok-1318', '/wt']).stdout,
    );
    expect(released.was_holder).toBe(true);
    expect(released.matched_by).toBe('branch_worktree');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: wrong agent_id, wrong branch+worktree — release no-ops, and the
// wrong non-empty identity is surfaced as matched_by="agent_id_mismatch"
// rather than silently reporting no match.
// ---------------------------------------------------------------------------
describe('no-match release is a no-op (ROK-1318)', () => {
  it('was_holder=false + matched_by=agent_id_mismatch when neither predicate matches', () => {
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'p',
      '--agent-id',
      'realholder0000000',
    ]);

    const released = parse<{
      released: boolean;
      was_holder: boolean;
      matched_by: string | null;
      holder: { agent_id: string };
    }>(
      runScript([
        'release',
        'different-branch',
        '/different/wt',
        '--agent-id',
        'someone-else1234',
      ]).stdout,
    );
    // released:true always (the release command ran), but was_holder:false.
    expect(released.released).toBe(true);
    expect(released.was_holder).toBe(false);
    // Wrong non-empty agent_id against an agent_id-stamped holder is surfaced.
    expect(released.matched_by).toBe('agent_id_mismatch');
    // Holder unchanged.
    expect(released.holder.agent_id).toBe('realholder0000000');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: acquire_refresh_self preserves agent_id when re-anchor omits it.
// This is the critical invariant: if deploy_dev.sh's bare-CLI re-anchor wiped
// the agent_id, the whole fix would be defeated (MCP release would fall back
// to branch+worktree, which is exactly the failure mode we're avoiding).
// ---------------------------------------------------------------------------
describe('acquire_refresh_self preserves agent_id (ROK-1318)', () => {
  it('keeps original agent_id when re-acquire omits --agent-id', () => {
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'initial',
      '--agent-id',
      'preserveme0000000',
    ]);

    // Re-anchor without --agent-id (simulates deploy_dev.sh). Use real PID so
    // auto_expire doesn't immediately reap the holder when status() runs.
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'reanchored',
      '--pid',
      String(process.pid),
      '--ttl-minutes',
      '240',
    ]);

    const status = parse<{ holder: { agent_id: string; purpose: string; pid: number } }>(
      runScript(['status']).stdout,
    );
    expect(status.holder.agent_id).toBe('preserveme0000000');
    // Other fields DID refresh.
    expect(status.holder.purpose).toBe('reanchored');
    expect(status.holder.pid).toBe(process.pid);
  });

  it('overwrites agent_id when re-acquire DOES supply a new one', () => {
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'initial',
      '--agent-id',
      'firstid0000000000',
    ]);
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'updated',
      '--agent-id',
      'secondid000000000',
    ]);
    const status = parse<{ holder: { agent_id: string } }>(runScript(['status']).stdout);
    expect(status.holder.agent_id).toBe('secondid000000000');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6: wrong non-empty --agent-id must NOT fall through to the
// branch+worktree match. A stale/foreign identity releasing someone else's
// lease is the shared-worktree hazard; the fallback is only for callers that
// don't plumb an agent_id at all (bare CLI) or holders that never had one
// (deploy_dev.sh-acquired).
// ---------------------------------------------------------------------------
describe('non-empty agent_id mismatch refuses branch+worktree fallback', () => {
  it('release with wrong --agent-id against an agent_id-stamped holder is refused', () => {
    runScript([
      'acquire',
      'rok-1318',
      '/wt',
      'p',
      '--agent-id',
      'realholder0000000',
    ]);

    // Same branch+worktree as the holder, but a DIFFERENT non-empty agent_id.
    const released = parse<{
      released: boolean;
      was_holder: boolean;
      matched_by: string | null;
    }>(
      runScript([
        'release',
        'rok-1318',
        '/wt',
        '--agent-id',
        'wrong-id-12345678',
      ]).stdout,
    );
    expect(released.released).toBe(true);
    expect(released.was_holder).toBe(false);
    expect(released.matched_by).toBe('agent_id_mismatch');

    // Holder untouched — the real owner keeps the lease.
    const status = parse<{ holder: { agent_id: string } }>(runScript(['status']).stdout);
    expect(status.holder.agent_id).toBe('realholder0000000');
  });

  it('release WITH --agent-id against an agent_id-less holder still falls back', () => {
    // deploy_dev.sh-style bare acquire — holder.agent_id normalized to "".
    runScript(['acquire', 'rok-1318', '/wt', 'p']);

    const released = parse<{ was_holder: boolean; matched_by: string | null }>(
      runScript([
        'release',
        'rok-1318',
        '/wt',
        '--agent-id',
        'mcp-agent00000000',
      ]).stdout,
    );
    expect(released.was_holder).toBe(true);
    expect(released.matched_by).toBe('branch_worktree');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5: agent_id matches even when branch RENAMES on the holder.
// (Edge case: git branch rename mid-lease — agent_id should still match.)
// ---------------------------------------------------------------------------
describe('agent_id matches across branch rename (ROK-1318)', () => {
  it('release succeeds when branch arg differs but agent_id matches', () => {
    runScript([
      'acquire',
      'old-branch-name',
      '/wt',
      'p',
      '--agent-id',
      'stableid000000000',
    ]);
    const released = parse<{ was_holder: boolean; matched_by: string | null }>(
      runScript([
        'release',
        'new-branch-name',
        '/wt',
        '--agent-id',
        'stableid000000000',
      ]).stdout,
    );
    expect(released.was_holder).toBe(true);
    expect(released.matched_by).toBe('agent_id');
  });
});
