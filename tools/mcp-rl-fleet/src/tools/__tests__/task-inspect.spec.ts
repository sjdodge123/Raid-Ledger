// ROK-1338 PR-1 — rl_task_inspect tests.
//
// Mirrors task.spec.ts structure: vi.mock('node:child_process') to stub SSH,
// then assert on argv shape + parsed return shape.
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

import { execute } from '../task-inspect.js';

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

function execFileFail(exitCode: number, stderr: string): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(Object.assign(new Error(stderr), { code: exitCode }), '', stderr);
    },
  );
}

const FIXTURE_FULL_TASK = {
  ok: true,
  task_id: 'abc123def',
  tool: 'rl_validate_ci',
  slot: 1,
  args: ['--no-e2e'],
  args_summary: '--no-e2e',
  started_at: '2026-05-20T12:00:00.000Z',
  finished_at: '2026-05-20T12:05:00.000Z',
  status: 'succeeded',
  script_exit_code: 0,
  pid: 12345,
  env: { RL_AGENT_ID: 'sdodge-deadbeef' },
  cwd: '/workspace',
  steps: [{ name: 'Build', status: 'PASS', duration_s: 45 }],
};

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_task_inspect — execute()', () => {
  it('returns ok:true with the full task JSON parsed into `task`', async () => {
    execFileOk(JSON.stringify(FIXTURE_FULL_TASK));
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(true);
    expect(result.task_id).toBe('abc123def');
    expect(result.task).toBeDefined();
    expect(result.task?.tool).toBe('rl_validate_ci');
    // Forensic: surfaces fields rl_task_status doesn't (raw args, pid, env, cwd).
    expect(result.task?.args).toEqual(['--no-e2e']);
    expect(result.task?.pid).toBe(12345);
    expect(result.task?.env).toEqual({ RL_AGENT_ID: 'sdodge-deadbeef' });
    expect(result.task?.cwd).toBe('/workspace');
  });

  it('rejects an invalid task_id at the executor layer (defense in depth)', async () => {
    // No execFile call should happen — validation short-circuits BEFORE SSH.
    const result = await execute({ task_id: 'bad id with spaces' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_task_id');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('rejects task_id containing shell-metacharacters', async () => {
    const result = await execute({ task_id: 'abc;rm -rf /' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_task_id');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('passes task_id single-quoted into the SSH remote command', async () => {
    execFileOk(JSON.stringify(FIXTURE_FULL_TASK));
    await execute({ task_id: 'abc123def' });
    const call = mockExecFile.mock.calls[0];
    const remote = String(call[1].at(-1));
    // The argument is single-quoted via shellQuote.
    expect(remote).toContain("'abc123def'");
    // The remote MUST reference the new orchestrator binary path.
    expect(remote).toContain('/srv/rl-infra/orchestrator/bin/task-inspect');
    // Fallback path (cat) is present too.
    expect(remote).toContain('/srv/rl-infra/state/tasks/');
  });

  it('returns ok:false error:"task not found" when the orchestrator says not_found', async () => {
    execFileOk(JSON.stringify({ ok: false, error: 'not_found' }));
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
    expect(result.task_id).toBe('abc123def');
  });

  it('returns ok:false error:"task not found" when the cat fallback hits ENOENT', async () => {
    execFileFail(
      1,
      'cat: /srv/rl-infra/state/tasks/abc123def.json: No such file or directory',
    );
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task not found');
  });

  it('returns ok:false error:"task not found" when stdout is empty', async () => {
    execFileOk('');
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task not found');
  });

  it('returns ok:false error:"failed_to_parse_response" when stdout is non-JSON garbage', async () => {
    execFileOk('not json at all\nstill not json');
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('failed_to_parse_response');
    expect(result.message).toContain('not json');
  });

  it('surfaces SSH failure stderr verbatim under task_inspect_failed', async () => {
    execFileFail(255, 'ssh: connect to host rl-infra port 22: Connection refused');
    const result = await execute({ task_id: 'abc123def' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_inspect_failed');
    expect(result.message).toContain('Connection refused');
  });
});
