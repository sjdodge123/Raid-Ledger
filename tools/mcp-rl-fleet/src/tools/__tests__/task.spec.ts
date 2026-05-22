// ROK-1331 M2 — rl_task_status, rl_task_wait, rl_task_cancel, rl_task_list.
// Mocks `child_process.execFile` so no SSH actually happens. The four executors
// call SSH to invoke M1's orchestrator binaries (task-status, task-cancel,
// task-list) and parse stdout JSON; for `rl_task_wait` they also spawn
// `inotifywait` over SSH then re-call status. We stub at the execFile boundary.
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

// NEW modules under test — DO NOT EXIST yet, so this import drives the red.
import {
  executeStatus,
  executeWait,
  executeCancel,
  executeList,
  TaskStatusResultSchema,
  McpRuntimeStatusSchema,
} from '../task.js';

/** Stub one execFile call with stdout JSON success. */
function execFileOk(stdoutJson: unknown): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, JSON.stringify(stdoutJson), '');
    },
  );
}

function execFileFail(exitCode = 1, stderr = 'boom'): void {
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(
        Object.assign(new Error(stderr), { code: exitCode }),
        '',
        stderr,
      );
    },
  );
}

const FIXTURE_RUNNING = {
  ok: true,
  task_id: 'abc123def',
  tool: 'rl_validate_ci',
  slot: 1,
  args_summary: '--no-e2e',
  started_at: '2026-05-20T12:00:00.000Z',
  finished_at: null,
  elapsed_seconds: 12,
  mcp_runtime_status: 'running',
  script_exit_code: null,
  steps: [],
  log_tail: '... building ...\n',
  log_url: 'https://fleet.gamernight.net/api/tasks/abc123def/log',
  log_path: '/srv/rl-infra/state/tasks/abc123def.log',
};

const FIXTURE_SUCCEEDED = {
  ...FIXTURE_RUNNING,
  finished_at: '2026-05-20T12:05:00.000Z',
  elapsed_seconds: 300,
  mcp_runtime_status: 'succeeded',
  script_exit_code: 0,
  steps: [
    { name: 'Build (all workspaces)', status: 'PASS', duration_s: 45 },
    { name: 'TypeScript (api + web)', status: 'PASS', duration_s: 30 },
    { name: 'Lint (api + web)', status: 'PASS', duration_s: 22 },
    { name: 'Unit tests + coverage', status: 'PASS', duration_s: 90 },
  ],
};

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('rl_task_status — executeStatus()', () => {
  it('returns a TaskStatusResult shape with steps[], log_tail, script_exit_code, mcp_runtime_status', async () => {
    execFileOk(FIXTURE_SUCCEEDED);
    const result = await executeStatus({ task_id: 'abc123def' });
    expect(result.ok).toBe(true);
    expect(result.task_id).toBe('abc123def');
    expect(result.script_exit_code).toBe(0);
    expect(result.mcp_runtime_status).toBe('succeeded');
    expect(Array.isArray(result.steps)).toBe(true);
    expect(result.steps.length).toBeGreaterThanOrEqual(4);
    // Bug B: separate fields
    expect(result).toHaveProperty('script_exit_code');
    expect(result).toHaveProperty('mcp_runtime_status');
    // Validate via the published schema.
    expect(() => TaskStatusResultSchema.parse(result)).not.toThrow();
  });

  it('script_exit_code is int|null AND mcp_runtime_status is the enum', () => {
    expect(() =>
      TaskStatusResultSchema.parse({
        ...FIXTURE_RUNNING,
        script_exit_code: null,
        mcp_runtime_status: 'running',
      }),
    ).not.toThrow();
    expect(() =>
      TaskStatusResultSchema.parse({
        ...FIXTURE_SUCCEEDED,
        script_exit_code: 42,
        mcp_runtime_status: 'failed',
      }),
    ).not.toThrow();
    expect(() =>
      TaskStatusResultSchema.parse({
        ...FIXTURE_SUCCEEDED,
        script_exit_code: 'not-an-int',
      }),
    ).toThrow();
    expect(() =>
      TaskStatusResultSchema.parse({
        ...FIXTURE_SUCCEEDED,
        mcp_runtime_status: 'made-up',
      }),
    ).toThrow();
  });

  it('McpRuntimeStatusSchema enumerates the full Bug-B status set', () => {
    for (const status of [
      'running',
      'succeeded',
      'failed',
      'killed_buffer_overflow',
      'killed_timeout',
      'cancelled',
    ]) {
      expect(() => McpRuntimeStatusSchema.parse(status)).not.toThrow();
    }
    expect(() => McpRuntimeStatusSchema.parse('unknown')).toThrow();
  });

  it('forwards log_tail_bytes to the task-status binary using the bash binary flag name', async () => {
    execFileOk(FIXTURE_SUCCEEDED);
    await executeStatus({ task_id: 'abc123def', log_tail_bytes: 500 });
    // The SSH remote command MUST use --log-tail-bytes (matches
    // orchestrator/bin/task-status' CLI). A previous regression used the
    // wrong flag name (--log-tail-lines) and the VM rejected every call;
    // this assertion now guards both the literal flag string AND the value.
    const firstCall = mockExecFile.mock.calls[0];
    const remote = String(firstCall[1].at(-1));
    expect(remote).toContain('--log-tail-bytes 500');
    expect(remote).not.toContain('--log-tail-lines');
  });

  it('defaults log_tail_bytes to 51200 (50 KiB) when caller omits it', async () => {
    execFileOk(FIXTURE_SUCCEEDED);
    await executeStatus({ task_id: 'abc123def' });
    const remote = String(mockExecFile.mock.calls[0][1].at(-1));
    expect(remote).toContain('--log-tail-bytes 51200');
  });

  it('surfaces a task_not_found error from the orchestrator verbatim', async () => {
    execFileOk({ ok: false, error: 'task_not_found', task_id: 'nopenope' });
    const result = await executeStatus({ task_id: 'nopenope' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('task_not_found');
  });
});

describe('rl_task_wait — executeWait()', () => {
  it('returns {ok:false, error:"timed_out", task_id} on timeout', async () => {
    // 1: probe inotifywait availability — succeed.
    execFileOk({ ok: true });
    // 2: ROK-1331 Codex P1-3 pre-check status — task still running.
    execFileOk({ ...FIXTURE_RUNNING, mcp_runtime_status: 'running' });
    // 3: watcher hangs; the wrapper must enforce the timeout.
    mockExecFile.mockImplementationOnce(() => {
      /* never call the callback — simulate hang */
    });
    // 4: final status read after timeout still reports running.
    execFileOk({ ...FIXTURE_RUNNING, mcp_runtime_status: 'running' });
    const result = await executeWait({ task_id: 'abc123def', timeout_seconds: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('timed_out');
    expect(result.task_id).toBe('abc123def');
  }, 15_000);

  it('returns the inotifywait_not_installed hint when the binary is missing', async () => {
    execFileFail(127, 'command not found');
    const result = await executeWait({ task_id: 'abc123def', timeout_seconds: 5 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('inotifywait_not_installed');
  });

  it('ROK-1331 Codex P1-3: returns immediately if task already terminal (pre-check shortcut)', async () => {
    // 1: probe inotifywait — succeed.
    execFileOk({ ok: true });
    // 2: pre-check status — already succeeded. Wrapper must NOT attach inotify.
    execFileOk({ ...FIXTURE_SUCCEEDED, mcp_runtime_status: 'succeeded' });
    const result = await executeWait({ task_id: 'abc123def', timeout_seconds: 600 });
    expect(result.ok).toBe(true);
    expect((result as { mcp_runtime_status?: string }).mcp_runtime_status).toBe('succeeded');
    // Confirm only the probe + the pre-check happened — no third inotify call.
    expect(mockExecFile.mock.calls.length).toBe(2);
  });

  it('ROK-1331 Codex P1-2: loops until terminal, ignoring heartbeat writes', async () => {
    // 1: probe inotifywait — succeed.
    execFileOk({ ok: true });
    // 2: pre-check — still running.
    execFileOk({ ...FIXTURE_RUNNING, mcp_runtime_status: 'running' });
    // 3: first inotifywait fires (heartbeat write).
    execFileOk({ ok: true });
    // 4: status read after first event — STILL running (heartbeat, not terminal).
    execFileOk({ ...FIXTURE_RUNNING, mcp_runtime_status: 'running' });
    // 5: second inotifywait fires (steps[] append).
    execFileOk({ ok: true });
    // 6: status read after second event — now terminal.
    execFileOk({ ...FIXTURE_SUCCEEDED, mcp_runtime_status: 'succeeded' });
    const result = await executeWait({ task_id: 'abc123def', timeout_seconds: 30 });
    expect(result.ok).toBe(true);
    expect((result as { mcp_runtime_status?: string }).mcp_runtime_status).toBe('succeeded');
    // 6 execFile calls total — proves we re-blocked on the heartbeat.
    expect(mockExecFile.mock.calls.length).toBe(6);
  });
});

describe('rl_task_cancel — executeCancel()', () => {
  it('returns {cancelled: true} on success', async () => {
    execFileOk({
      ok: true,
      task_id: 'abc123def',
      mcp_runtime_status: 'cancelled',
    });
    const result = await executeCancel({ task_id: 'abc123def', reason: 'operator-requested' });
    expect(result.ok).toBe(true);
    expect(result.cancelled).toBe(true);
  });

  it('is idempotent: if the task already terminal, still returns ok:true', async () => {
    execFileOk({
      ok: true,
      task_id: 'abc123def',
      mcp_runtime_status: 'succeeded',
    });
    const result = await executeCancel({ task_id: 'abc123def', reason: 'cleanup' });
    expect(result.ok).toBe(true);
  });

  // Regression: ROK-1338 PR-3 dogfood caught this shim passing `--reason <r>`
  // which task-cancel (positional <task_id> <reason>) recorded as the literal
  // string "--reason" in cancel_reason. Lock the positional contract.
  it('passes task_id + reason as positional argv to the orchestrator binary (no --reason flag)', async () => {
    execFileOk({ ok: true, task_id: 'abc123def', mcp_runtime_status: 'cancelled' });
    await executeCancel({ task_id: 'abc123def', reason: 'dogfood done' });
    const firstCall = mockExecFile.mock.calls[0];
    const argv = JSON.stringify(firstCall.slice(0, 2));
    expect(argv).toContain('/srv/rl-infra/orchestrator/bin/task-cancel');
    expect(argv).toContain('abc123def');
    expect(argv).toContain('dogfood done');
    expect(argv).not.toContain('--reason');
  });
});

describe('rl_task_list — executeList()', () => {
  it('filters by slot/status/limit and returns the array', async () => {
    execFileOk({
      ok: true,
      tasks: [
        { ...FIXTURE_RUNNING },
        { ...FIXTURE_SUCCEEDED },
      ],
    });
    const result = await executeList({ slot: 1, status: 'running', limit: 10 });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.tasks)).toBe(true);
    // Verify the SSH argv carried the filters.
    const firstCall = mockExecFile.mock.calls[0];
    const argv = JSON.stringify(firstCall.slice(0, 2));
    expect(argv).toMatch(/--slot.*1|--slot\D+1/);
    expect(argv).toMatch(/--status.*running/);
    expect(argv).toMatch(/--limit.*10|--limit\D+10/);
  });

  it('returns {ok:true, tasks:[]} when no matching tasks (not an error)', async () => {
    execFileOk({ ok: true, tasks: [] });
    const result = await executeList({});
    expect(result.ok).toBe(true);
    expect(result.tasks).toEqual([]);
  });
});
