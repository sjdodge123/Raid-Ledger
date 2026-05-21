// ROK-1338 PR-1 — rl_status schema extensions tests.
//
// Verifies the TS-side StatusResult shape accepts the new fields:
//   - top-level `deployed_sha?: string | null`
//   - per-runner `last_sync_at?: string | null`
//   - per-runner `worktree_head?: string | null`
// All three are optional + nullable so an orchestrator that hasn't been
// redeployed yet still parses correctly (backward compat).
//
// We mock the rl CLI invocation (runRl) by stubbing execFile, then assert
// that parseJsonFromStdout returns a result the StatusResult type accepts
// at compile time AND that the values pass through verbatim.
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

import { execute, type StatusResult, type RunnerStat } from '../status.js';

function execFileOk(stdout: string): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, stdout, '');
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

const BASE_SHAPE = {
  ok: true,
  generated_at: '2026-05-20T14:00:00Z',
  slots: [],
  envs: [],
  runners: [],
  host: { memory: '8G/16G', disk: '50G/100G (50%)', loadavg: '0.5 0.6 0.7' },
  queue: [],
  queue_depth: 0,
  queue_head: null,
};

describe('rl_status — ROK-1338 PR-1 schema extensions', () => {
  it('top-level deployed_sha accepts a 7-char SHA string', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        deployed_sha: 'abc1234',
      }),
    );
    const result: StatusResult = await execute();
    expect(result.ok).toBe(true);
    expect(result.deployed_sha).toBe('abc1234');
  });

  it('top-level deployed_sha accepts null (file not yet written by deploy script)', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        deployed_sha: null,
      }),
    );
    const result: StatusResult = await execute();
    expect(result.ok).toBe(true);
    expect(result.deployed_sha).toBeNull();
  });

  it('top-level deployed_sha is gracefully absent when orchestrator is pre-PR-1', async () => {
    execFileOk(JSON.stringify(BASE_SHAPE));
    const result: StatusResult = await execute();
    expect(result.ok).toBe(true);
    // No `deployed_sha` key at all — the field is optional.
    expect(result).not.toHaveProperty('deployed_sha');
  });

  it('runners[] accepts both new sync-state fields (populated)', async () => {
    const runner: RunnerStat = {
      container: 'rl-runner-1',
      cpu: '12.34%',
      mem: '512MiB / 4GiB',
      net: '1MB / 2MB',
      block: '0B / 0B',
      last_sync_at: '2026-05-20T14:30:00Z',
      worktree_head: 'abc1234',
    };
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        runners: [runner],
      }),
    );
    const result: StatusResult = await execute();
    expect(result.runners).toHaveLength(1);
    expect(result.runners?.[0].last_sync_at).toBe('2026-05-20T14:30:00Z');
    expect(result.runners?.[0].worktree_head).toBe('abc1234');
  });

  it('runners[] accepts null for both new fields (slot not claimed)', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        runners: [
          {
            container: 'rl-runner-2',
            cpu: '0.00%',
            mem: '50MiB / 4GiB',
            net: '0B / 0B',
            block: '0B / 0B',
            last_sync_at: null,
            worktree_head: null,
          },
        ],
      }),
    );
    const result: StatusResult = await execute();
    expect(result.runners?.[0].last_sync_at).toBeNull();
    expect(result.runners?.[0].worktree_head).toBeNull();
  });

  it('runners[] tolerates the new fields being absent (pre-PR-1 orchestrator)', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        runners: [
          {
            container: 'rl-runner-1',
            cpu: '5%',
            mem: '256MiB / 4GiB',
            net: '0B / 0B',
            block: '0B / 0B',
          },
        ],
      }),
    );
    const result: StatusResult = await execute();
    expect(result.runners?.[0].container).toBe('rl-runner-1');
    expect(result.runners?.[0].last_sync_at).toBeUndefined();
    expect(result.runners?.[0].worktree_head).toBeUndefined();
  });

  it('preserves all legacy runner fields (cpu/mem/net/block) alongside new ones', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        runners: [
          {
            container: 'rl-runner-3',
            cpu: '88.0%',
            mem: '1GiB / 4GiB',
            net: '500KB / 1MB',
            block: '4MB / 0B',
            last_sync_at: '2026-05-20T14:25:00Z',
            worktree_head: 'deadbee',
          },
        ],
      }),
    );
    const result: StatusResult = await execute();
    const r = result.runners?.[0];
    expect(r?.cpu).toBe('88.0%');
    expect(r?.mem).toBe('1GiB / 4GiB');
    expect(r?.net).toBe('500KB / 1MB');
    expect(r?.block).toBe('4MB / 0B');
    expect(r?.last_sync_at).toBe('2026-05-20T14:25:00Z');
    expect(r?.worktree_head).toBe('deadbee');
  });

  it('mixed runners: one with sync state, one without', async () => {
    execFileOk(
      JSON.stringify({
        ...BASE_SHAPE,
        runners: [
          {
            container: 'rl-runner-1',
            cpu: '10%',
            mem: '300MiB / 4GiB',
            net: '0B / 0B',
            block: '0B / 0B',
            last_sync_at: '2026-05-20T14:00:00Z',
            worktree_head: 'fff0000',
          },
          {
            container: 'rl-runner-2',
            cpu: '0%',
            mem: '50MiB / 4GiB',
            net: '0B / 0B',
            block: '0B / 0B',
            last_sync_at: null,
            worktree_head: null,
          },
        ],
      }),
    );
    const result: StatusResult = await execute();
    expect(result.runners?.[0].worktree_head).toBe('fff0000');
    expect(result.runners?.[1].worktree_head).toBeNull();
  });
});
