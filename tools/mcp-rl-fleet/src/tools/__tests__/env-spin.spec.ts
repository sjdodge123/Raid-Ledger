// rl_env_spin — async dispatch (TDB:208) + the synchronous spinEnv core.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const spawnLocalRunner = vi.fn();
const waitLocalTask = vi.fn();
vi.mock('../../local-task.js', () => ({
  newLocalTaskId: () => 'local-abc12345abcd',
  spawnLocalRunner: (...a: unknown[]) => spawnLocalRunner(...a),
  waitLocalTask: (...a: unknown[]) => waitLocalTask(...a),
}));

const runRl = vi.fn();
vi.mock('../../exec.js', () => ({
  runRl: (...a: unknown[]) => runRl(...a),
  parseJsonFromStdout: (s: string) => {
    try {
      return JSON.parse(s.trim()) as unknown;
    } catch {
      return null;
    }
  },
}));

import { execute, spinEnv, TOOL_DESCRIPTION } from '../env-spin.js';
import { runSpinTask } from '../env-spin-runner.js';
import type { LocalTaskJson } from '../../local-task.js';

const SECRET = 'rl-0badc0ffee123456';
const SPIN_JSON = JSON.stringify({
  ok: true,
  slug: 'rok-x',
  slot: 2,
  url: 'https://slot-2.gamernight.net',
  slot_url: 'https://slot-2.gamernight.net',
  internal_url: 'http://rok-x.rl.lan',
  admin_email: 'admin@local',
  admin_password: SECRET,
  operator_admin: 'configured',
  bootstrap_warnings: [{ code: 'admin_bootstrap_failed', detail: 'tail' }],
});

beforeEach(() => {
  spawnLocalRunner.mockReset();
  waitLocalTask.mockReset();
  runRl.mockReset();
  // A never-resolving spin: if execute() awaited it, the call would hang.
  runRl.mockReturnValue(new Promise(() => {}));
  spawnLocalRunner.mockReturnValue({ task_id: 'local-abc12345abcd', pid: 4242, started_at: '2026-10-04T00:00:00.000Z' });
});

describe('rl_env_spin execute() — async by default', () => {
  it('returns a local- task_id without running the spin inline', async () => {
    // Race against a short timer so an inline (awaited) spin fails on its own
    // assertion rather than by a test timeout.
    const raced = await Promise.race([
      execute({ slug: 'rok-x' }),
      new Promise<'spin_ran_inline'>((r) => setTimeout(() => r('spin_ran_inline'), 500)),
    ]);
    expect(raced).not.toBe('spin_ran_inline');
    const res = raced as { ok: boolean; task_id?: string; message?: string };
    expect(res.ok).toBe(true);
    expect(res.task_id).toMatch(/^local-/);
    expect(res.message).toMatch(/rl_task_status local-abc12345abcd/);
    expect(spawnLocalRunner).toHaveBeenCalledWith(
      'local-abc12345abcd',
      'rl_env_spin',
      expect.objectContaining({ slug: 'rok-x' }),
      'rok-x',
    );
    expect(runRl).not.toHaveBeenCalled();
    expect(waitLocalTask).not.toHaveBeenCalled();
  });

  it('wait:true hands the task id and requested budget to waitLocalTask (which applies the 120s cap)', async () => {
    waitLocalTask.mockResolvedValue({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    const res = (await execute({ slug: 'rok-x', wait: true, wait_timeout_seconds: 300 })) as {
      mcp_runtime_status?: string;
    };
    expect(waitLocalTask).toHaveBeenCalledWith('local-abc12345abcd', 300);
    expect(res.mcp_runtime_status).toBe('succeeded');
    expect(runRl).not.toHaveBeenCalled();
  });

  it('the default dispatch payload carries no admin_password key', async () => {
    const res = await execute({ slug: 'rok-x', include_credentials: true });
    expect(Object.keys(res)).not.toContain('admin_password');
    expect(JSON.stringify(res)).not.toContain(SECRET);
  });

  it('an omitted worktree_path defaults to the server cwd so RL_AGENT_ID hashes the session folder', async () => {
    await execute({ slug: 'rok-x' });
    const params = spawnLocalRunner.mock.calls[0][2] as { worktree_path?: string };
    expect(params.worktree_path).toBe(process.cwd());
  });

  it('an explicit worktree_path is passed through unchanged', async () => {
    await execute({ slug: 'rok-x', worktree_path: '/wt' });
    const params = spawnLocalRunner.mock.calls[0][2] as { worktree_path?: string };
    expect(params.worktree_path).toBe('/wt');
  });

  it('include_credentials adds a credentials_hint naming the rl_task_status route', async () => {
    const res = (await execute({ slug: 'rok-x', include_credentials: true })) as { credentials_hint?: string };
    expect(res).toMatchObject({
      credentials_hint: expect.stringContaining(
        "rl_task_status({task_id: 'local-abc12345abcd', include_credentials: true})",
      ),
    });
  });

  it('include_credentials with wait:true adds the hint to the wait payload too', async () => {
    waitLocalTask.mockResolvedValue({ ok: true, mcp_runtime_status: 'succeeded', steps: [] });
    const res = (await execute({ slug: 'rok-x', include_credentials: true, wait: true })) as {
      credentials_hint?: string;
      mcp_runtime_status?: string;
    };
    expect(res).toMatchObject({
      mcp_runtime_status: 'succeeded',
      credentials_hint: expect.stringContaining('include_credentials: true'),
    });
  });

  it('no credentials_hint when include_credentials is not set', async () => {
    const res = await execute({ slug: 'rok-x' });
    expect(res).not.toHaveProperty('credentials_hint');
  });

  it('TOOL_DESCRIPTION documents the async contract and the url field', () => {
    expect(TOOL_DESCRIPTION).toMatch(/ASYNC BY DEFAULT/);
    expect(TOOL_DESCRIPTION).toMatch(/120s/);
    expect(TOOL_DESCRIPTION).toMatch(/rl_task_status/);
    expect(TOOL_DESCRIPTION).toMatch(/slot-N/);
  });
});

describe('spinEnv() — synchronous core', () => {
  it('parses the rl stdout and strips admin_password by default', async () => {
    runRl.mockResolvedValue({ stdout: SPIN_JSON, stderr: '', exitCode: 0 });
    const res = await spinEnv({ slug: 'rok-x' });
    expect(runRl).toHaveBeenCalledWith(['env', 'spin', '--slug', 'rok-x'], { cwd: undefined });
    expect(res.ok).toBe(true);
    expect(res.url).toBe('https://slot-2.gamernight.net');
    expect(res).not.toHaveProperty('admin_password');
    expect(res.admin_password_available).toBe(true);
  });
});

function freshTask(): LocalTaskJson {
  return {
    task_id: 'local-abc12345abcd',
    tool: 'rl_env_spin',
    slot: null,
    args_summary: 'rok-x',
    started_at: '2026-10-04T00:00:00.000Z',
    finished_at: null,
    mcp_runtime_status: 'running',
    script_exit_code: null,
    steps: [],
    current_step: 'starting',
    log_path: '/tmp/local-abc12345abcd.log',
    pid: 4242,
    failed_step: null,
  };
}

describe('runSpinTask() — the detached runner step', () => {
  it('records env_spin and copies every result field into the task JSON', async () => {
    runRl.mockResolvedValue({ stdout: SPIN_JSON, stderr: '', exitCode: 0 });
    const current = freshTask();
    const ctx = { setCurrent: vi.fn(), recordStep: vi.fn() };
    const out = await runSpinTask({ slug: 'rok-x' }, current, ctx);
    expect(out.ok).toBe(true);
    expect(out.message).toContain('https://slot-2.gamernight.net');
    expect(ctx.setCurrent).toHaveBeenCalledWith('env_spin');
    expect(ctx.recordStep).toHaveBeenCalledWith('env_spin', true, expect.any(Number), undefined, undefined);
    expect(current).toMatchObject({
      slot: 2,
      url: 'https://slot-2.gamernight.net',
      slot_url: 'https://slot-2.gamernight.net',
      internal_url: 'http://rok-x.rl.lan',
      admin_email: 'admin@local',
      // The 0600 task JSON is the sink; status reads redact it by default.
      admin_password: SECRET,
      operator_admin: 'configured',
      bootstrap_warnings: [{ code: 'admin_bootstrap_failed', detail: 'tail' }],
    });
  });

  it('a failed spin returns the error and message', async () => {
    runRl.mockResolvedValue({ stdout: '', stderr: 'boom', exitCode: 1 });
    const current = freshTask();
    const out = await runSpinTask({ slug: 'rok-x' }, current, { setCurrent: vi.fn(), recordStep: vi.fn() });
    expect(out).toMatchObject({ ok: false, error: 'failed_to_parse_response' });
    expect(out.message).toContain('boom');
    expect(current.url).toBeNull();
  });

  it('a structured spin failure keeps hint, phase and exit_code in the task JSON', async () => {
    const failure = {
      ok: false,
      error: 'env_spin_aborted_unexpectedly',
      message: 'aborted',
      phase: 'register_new',
      exit_code: 3,
      hint: 'run bash -x env-spin',
    };
    runRl.mockResolvedValue({ stdout: JSON.stringify(failure), stderr: '', exitCode: 1 });
    const current = freshTask();
    const out = await runSpinTask({ slug: 'rok-x' }, current, { setCurrent: vi.fn(), recordStep: vi.fn() });
    expect(out.error).toBe('env_spin_aborted_unexpectedly');
    expect(out.message).toBe(
      'env spin failed for rok-x: aborted (phase=register_new, exit_code=3) — hint: run bash -x env-spin',
    );
    expect(current.hint).toBe('run bash -x env-spin');
  });
});

describe('LocalTaskJsonSchema — spin task fields survive validation', () => {
  it('accepts tool rl_env_spin and keeps operator_admin + bootstrap_warnings', async () => {
    const actual = await vi.importActual<typeof import('../../local-task.js')>('../../local-task.js');
    const parsed = actual.LocalTaskJsonSchema.safeParse({
      ...freshTask(),
      operator_admin: 'first-login',
      bootstrap_warnings: [{ code: 'c', detail: 'd' }],
      hint: 'h',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.hint).toBe('h');
    expect(parsed.data).toMatchObject({
      tool: 'rl_env_spin',
      operator_admin: 'first-login',
      bootstrap_warnings: [{ code: 'c', detail: 'd' }],
    });
  });
});
