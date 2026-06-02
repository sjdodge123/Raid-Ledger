// rl_force_resync — standalone recovery tool for a wedged Mutagen sync.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runRl = vi.fn();
const parseJsonFromStdout = vi.fn();
vi.mock('../../exec.js', () => ({
  runRl: (...a: unknown[]) => runRl(...a),
  parseJsonFromStdout: (...a: unknown[]) => parseJsonFromStdout(...a),
}));

import { execute } from '../force-resync.js';

beforeEach(() => {
  runRl.mockReset();
  parseJsonFromStdout.mockReset();
});

describe('rl_force_resync', () => {
  it('invokes `rl resync` with the worktree cwd and returns the parsed envelope', async () => {
    runRl.mockResolvedValue({
      stdout: '{"ok":true,"slot":2,"branch":"feat","resynced":true}',
      stderr: '',
      exitCode: 0,
    });
    parseJsonFromStdout.mockReturnValue({ ok: true, slot: 2, branch: 'feat', resynced: true });

    const res = await execute({ worktree_path: '/Users/op/Documents/Projects/Raid-Ledger--wt' });

    expect(runRl).toHaveBeenCalledWith(['resync'], {
      cwd: '/Users/op/Documents/Projects/Raid-Ledger--wt',
      timeoutMs: 180_000,
    });
    expect(res.ok).toBe(true);
    expect(res.slot).toBe(2);
    expect(res.resynced).toBe(true);
  });

  it('surfaces a friendly error when output is unparseable (e.g. no active claim)', async () => {
    runRl.mockResolvedValue({
      stdout: '',
      stderr: 'no slot — run claim first',
      exitCode: 1,
    });
    parseJsonFromStdout.mockReturnValue(null);

    const res = await execute({});

    expect(res.ok).toBe(false);
    expect(res.error).toBe('resync_failed');
    expect(res.message).toContain('no slot');
  });
});
