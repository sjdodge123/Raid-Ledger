// ROK-1510 — resolveWorktreeCommitSha reads the LAPTOP worktree HEAD (the
// runner's /workspace/.git replica reports the base sha for a worktree branch).
// Mocks the child_process boundary the same way runner-git.spec.ts does.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import { resolveWorktreeCommitSha } from '../worktree-sha.js';

const HEAD = 'e9995e61aabbccddeeff00112233445566778899';

function execFileOk(stdout: string): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, o: string, s: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, '');
    },
  );
}
function execFileFail(): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, o: string, s: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(
        Object.assign(new Error('not a git repository'), { code: 128 }),
        '',
        'fatal: not a git repository',
      );
    },
  );
}

beforeEach(() => mockExecFile.mockReset());

describe('resolveWorktreeCommitSha (ROK-1510)', () => {
  it('resolves the worktree HEAD via git -C <worktree_path> rev-parse HEAD', async () => {
    execFileOk(`${HEAD}\n`);
    const sha = await resolveWorktreeCommitSha('/wt');
    expect(sha).toBe(HEAD);
    expect(mockExecFile.mock.calls[0][0]).toBe('git');
    expect(mockExecFile.mock.calls[0][1]).toEqual(['-C', '/wt', 'rev-parse', 'HEAD']);
  });

  it('returns empty when git fails (non-git worktree)', async () => {
    execFileFail();
    expect(await resolveWorktreeCommitSha('/wt')).toBe('');
  });

  it('returns empty when stdout is not a 40-hex sha', async () => {
    execFileOk('fatal: not a git repo');
    expect(await resolveWorktreeCommitSha('/wt')).toBe('');
  });

  it('defaults to process.cwd() when worktree_path is omitted', async () => {
    execFileOk(`${HEAD}\n`);
    await resolveWorktreeCommitSha();
    expect(mockExecFile.mock.calls[0][1][1]).toBe(process.cwd());
  });
});
