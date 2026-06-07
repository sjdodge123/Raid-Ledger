// ROK-1362 — rl_run_on_runner bounded execution (AC #4):
//   timeout_seconds <= 120 (or omitted, default 60) → sync {stdout, stderr, exit_code}
//   timeout_seconds  > 120 → auto-routed via task-start → {ok, routed:'task', task_id}
import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => ({ state: { mode: 'ok' as 'ok' | 'fail' } }));

vi.mock('node:child_process', async () => {
  const util = await import('node:util');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const execFile: any = () => {};
  execFile[util.promisify.custom] = () =>
    hoisted.state.mode === 'fail'
      ? Promise.reject(Object.assign(new Error('boom'), { code: 2, stdout: '', stderr: 'boom' }))
      : Promise.resolve({ stdout: 'sync-out', stderr: '' });
  return { execFile };
});

const resolveSlot = vi.fn(async (..._a: unknown[]) => 3);
const execFileP = vi.fn();
vi.mock('../runner-git.js', () => ({
  resolveSlot: (...a: unknown[]) => resolveSlot(...a),
  execFileP: (...a: unknown[]) => execFileP(...a),
}));

vi.mock('../../exec.js', () => ({
  buildSshArgs: vi.fn(async () => ['-o', 'BatchMode=yes', 'rl-agent@host', 'cmd']),
  getSshTarget: vi.fn(async () => ({ user: 'rl-agent', host: 'rl-infra' })),
  deriveAgentId: vi.fn(() => 'agent-xyz'),
  shellQuote: (s: string) => `'${s}'`,
  synthesizeEmptyStderrDiagnostic: () => 'diag',
}));

import { execute } from '../run-on-runner.js';

beforeEach(() => {
  hoisted.state.mode = 'ok';
  resolveSlot.mockClear();
  execFileP.mockReset();
});

describe('rl_run_on_runner — sync path (<=120)', () => {
  it('omitted timeout (default 60) stays sync and never routes', async () => {
    const res = (await execute({ command: 'ls /workspace' })) as { stdout?: string; routed?: string };
    expect(res.routed).toBeUndefined();
    expect('stdout' in res).toBe(true);
    expect(resolveSlot).not.toHaveBeenCalled();
  });

  it('timeout 30 stays sync and returns {stdout, exit_code}', async () => {
    const res = (await execute({ command: 'ls', timeout_seconds: 30 })) as {
      ok: boolean;
      stdout?: string;
      exit_code?: number;
      routed?: string;
    };
    expect(res.routed).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(res.stdout).toBe('sync-out');
    expect(res.exit_code).toBe(0);
    expect(execFileP).not.toHaveBeenCalled();
  });

  it('a failing sync command returns the {ok:false, exit_code} shape (still sync)', async () => {
    hoisted.state.mode = 'fail';
    const res = (await execute({ command: 'false', timeout_seconds: 10 })) as {
      ok: boolean;
      exit_code?: number;
      routed?: string;
    };
    expect(res.routed).toBeUndefined();
    expect(res.ok).toBe(false);
    expect(res.exit_code).toBe(2);
  });
});

describe('rl_run_on_runner — auto-route path (>120)', () => {
  it('timeout 1800 dispatches via task-start and returns {routed:"task", task_id}', async () => {
    execFileP.mockResolvedValue({
      stdout: JSON.stringify({ task_id: 'deadbeef1234', started_at: '2026-06-07T00:00:00.000Z' }),
      stderr: '',
    });
    const res = (await execute({ command: 'npm test', timeout_seconds: 1800 })) as {
      ok: boolean;
      routed?: string;
      task_id?: string;
      message?: string;
    };
    expect(res.ok).toBe(true);
    expect(res.routed).toBe('task');
    expect(res.task_id).toBe('deadbeef1234');
    expect(res.message).toMatch(/dispatched as a VM task/);
    // It resolved the slot + dispatched via task-start (NOT a Zod rejection).
    expect(resolveSlot).toHaveBeenCalledTimes(1);
    const argv = JSON.stringify(execFileP.mock.calls[0]);
    expect(argv).toContain('task-start');
    expect(argv).toContain('--tool rl_run_on_runner');
  });

  it('surfaces task_start_failed (routed shape) when the dispatch SSH fails', async () => {
    execFileP.mockRejectedValue(Object.assign(new Error('ssh down'), { code: 255, stderr: 'ssh down' }));
    const res = (await execute({ command: 'npm test', timeout_seconds: 1800 })) as {
      ok: boolean;
      routed?: string;
      error?: string;
    };
    expect(res.ok).toBe(false);
    expect(res.routed).toBe('task');
    expect(res.error).toBe('task_start_failed');
  });
});
