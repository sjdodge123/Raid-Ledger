// rl_claim branch derivation (2026-10-19 incident): a claim with no `branch`
// reached the orchestrator with branch "" and branch-mismatch-destroyed a
// pinned env. The MCP now derives the branch from worktree_path, refuses a
// detached/unresolvable HEAD, and keeps an explicit `branch` authoritative.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFileP = vi.fn();
const runRl = vi.fn();
vi.mock('../exec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../exec.js')>();
  return {
    ...actual,
    execFileP: (...a: unknown[]) => execFileP(...a),
    runRl: (...a: unknown[]) => runRl(...a),
  };
});

const { execute } = await import('../tools/claim.js');

const WT = '/tmp/some-worktree';

function claimArgs(): unknown {
  return runRl.mock.calls[0]?.[0];
}

beforeEach(() => {
  execFileP.mockReset();
  runRl.mockReset();
  runRl.mockResolvedValue({ stdout: '{"ok":true,"slot":4}', stderr: '', exitCode: 0 });
});

describe('rl_claim branch derivation', () => {
  it('derives --branch from the worktree HEAD when branch is omitted', async () => {
    execFileP.mockResolvedValue({ stdout: 'fix/my-branch\n', stderr: '' });
    const res = await execute({ worktree_path: WT, wait: false });
    expect(execFileP).toHaveBeenCalledWith('git', ['-C', WT, 'rev-parse', '--abbrev-ref', 'HEAD'], expect.anything());
    expect(claimArgs()).toEqual(['claim', '--branch', 'fix/my-branch']);
    expect(res.branch).toBe('fix/my-branch');
  });

  it('keeps an explicit branch authoritative (no git call)', async () => {
    const res = await execute({ branch: 'explicit', worktree_path: WT, wait: false });
    expect(execFileP).not.toHaveBeenCalled();
    expect(claimArgs()).toEqual(['claim', '--branch', 'explicit']);
    expect(res.branch).toBe('explicit');
  });

  it('refuses a detached HEAD without sending a claim', async () => {
    execFileP.mockResolvedValue({ stdout: 'HEAD\n', stderr: '' });
    const res = await execute({ worktree_path: WT, wait: false });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('claim_branch_unresolved');
    expect(runRl).not.toHaveBeenCalled();
  });

  it('refuses when git fails without sending a claim', async () => {
    execFileP.mockRejectedValue(new Error('fatal: not a git repository'));
    const res = await execute({ worktree_path: WT, wait: false });
    expect(res.error).toBe('claim_branch_unresolved');
    expect(res.message).toContain('not a git repository');
    expect(runRl).not.toHaveBeenCalled();
  });
});
