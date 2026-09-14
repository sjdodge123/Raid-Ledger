// ROK-1567 — cheap fleet-task waits.
//
// The Lead polled rl_task_status ~50x in one session at ~1.5k tokens a call:
// every result echoed the full `cmd` array (which carries ADMIN_PASSWORD=...),
// `env`, the step table and a 50KB log tail. Two defects, one spec:
//   1. a non-terminal poll should be BRIEF (progress only) by default;
//   2. `cmd` must never echo the env credential, in ANY mode.
// Mocks child_process.execFile so no SSH happens (same boundary as task.spec.ts).
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

import { applyStatusProjection, executeStatus, executeWait, redactCmd } from '../task.js';

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

const SECRET = 'rl-0badc0ffee123456';

/** The orchestrator's task-status JSON, verbatim-ish. */
function taskJson(status: string): Record<string, unknown> {
  return {
    ok: true,
    task_id: 'abc12345',
    tool: 'rl_validate_ci',
    slot: 2,
    args_summary: `validate-ci --static ADMIN_PASSWORD='${SECRET}'`,
    started_at: '2026-09-14T10:00:00Z',
    finished_at: status === 'running' ? null : '2026-09-14T10:12:00Z',
    elapsed_seconds: 720,
    mcp_runtime_status: status,
    script_exit_code: status === 'running' ? null : 0,
    current_step: 'Playwright (desktop + mobile)',
    steps: [{ name: 'Lint', status: 'PASS', duration_s: 12 }],
    log_tail: 'x'.repeat(50_000),
    log_url: 'http://fleet.gamernight.net/tasks/abc12345',
    log_path: '/srv/rl-infra/tasks/abc12345.log',
    cmd: ['bash', '-lc', `ADMIN_PASSWORD='${SECRET}' ./scripts/validate-ci.sh --static`],
    env: { RL_AGENT_ID: 'deadbeef' },
    cwd: '/workspace',
  };
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('executeStatus — brief mode (ROK-1567)', () => {
  it('defaults to BRIEF while the task is non-terminal: no cmd, no env, no log_tail', async () => {
    execFileOk(taskJson('running'));
    const r = (await executeStatus({ task_id: 'abc12345' })) as unknown as Record<string, unknown>;

    expect(
      'cmd' in r,
      `a running-task poll must not echo the command array — expected the key to be absent, got ${JSON.stringify(r.cmd)}`,
    ).toBe(false);
    expect(
      'log_tail' in r,
      `a running-task poll must not carry a 50KB log tail — expected the key to be absent, got ${String(r.log_tail).length} chars`,
    ).toBe(false);
    expect('env' in r, 'env must be absent in brief mode').toBe(false);
    expect('cwd' in r, 'cwd must be absent in brief mode').toBe(false);
    expect('log_path' in r, 'log_path must be absent in brief mode').toBe(false);
    expect('log_url' in r, 'log_url must be absent in brief mode').toBe(false);
  });

  it('keeps the progress fields a poller actually reads', async () => {
    execFileOk(taskJson('running'));
    const r = (await executeStatus({ task_id: 'abc12345' })) as unknown as Record<string, unknown>;

    expect(r.task_id).toBe('abc12345');
    expect(r.tool).toBe('rl_validate_ci');
    expect(r.slot).toBe(2);
    expect(r.mcp_runtime_status).toBe('running');
    expect(
      r.current_step,
      'current_step is the whole point of a poll — expected the Playwright tier',
    ).toBe('Playwright (desktop + mobile)');
    expect(r.steps).toEqual([{ name: 'Lint', status: 'PASS', duration_s: 12 }]);
    expect(r.elapsed_seconds).toBe(720);
    expect(r.started_at).toBe('2026-09-14T10:00:00Z');
  });

  it('returns the FULL shape by default once the task is terminal', async () => {
    execFileOk(taskJson('succeeded'));
    const r = (await executeStatus({ task_id: 'abc12345' })) as unknown as Record<string, unknown>;

    expect(
      'cmd' in r,
      'a terminal read is the forensic one — expected cmd present, got absent',
    ).toBe(true);
    expect(
      (r.log_tail as string)?.length,
      'a terminal read keeps the log tail — expected 50000 chars',
    ).toBe(50_000);
  });

  it('brief:false on a RUNNING task returns cmd — but redacted', async () => {
    execFileOk(taskJson('running'));
    const r = (await executeStatus({ task_id: 'abc12345', brief: false })) as unknown as Record<
      string,
      unknown
    >;

    expect('cmd' in r, 'brief:false is the explicit opt-out — expected cmd present').toBe(true);
    expect(
      JSON.stringify(r).includes(SECRET),
      `the env admin password must never survive in a task payload — expected false, got true for ${JSON.stringify(r.cmd)}`,
    ).toBe(false);
    expect((r.cmd as string[])[2]).toContain("ADMIN_PASSWORD='***'");
  });

  it('redacts the credential out of args_summary too', async () => {
    execFileOk(taskJson('succeeded'));
    const r = (await executeStatus({ task_id: 'abc12345' })) as unknown as Record<string, unknown>;
    expect(r.args_summary).toBe("validate-ci --static ADMIN_PASSWORD='***'");
  });

  it('brief:true on a TERMINAL task still strips the heavy fields', async () => {
    execFileOk(taskJson('succeeded'));
    const r = (await executeStatus({ task_id: 'abc12345', brief: true })) as unknown as Record<
      string,
      unknown
    >;
    expect('log_tail' in r, 'explicit brief:true wins over the terminal default').toBe(false);
    expect(r.mcp_runtime_status).toBe('succeeded');
  });
});

describe('redactCmd', () => {
  it('handles both quoting forms', () => {
    expect(redactCmd([`ADMIN_PASSWORD='${SECRET}' run.sh`])).toEqual([
      "ADMIN_PASSWORD='***' run.sh",
    ]);
    expect(redactCmd([`ADMIN_PASSWORD=${SECRET} run.sh`])).toEqual(["ADMIN_PASSWORD='***' run.sh"]);
    expect(redactCmd([`ADMIN_PASSWORD="${SECRET}" run.sh`])).toEqual([
      "ADMIN_PASSWORD='***' run.sh",
    ]);
  });

  it('redacts prefixed variants (RL_ADMIN_PASSWORD) and leaves other assignments intact', () => {
    expect(redactCmd([`RL_ADMIN_PASSWORD='${SECRET}' CI=1 SLOT=2 ./go.sh`])).toEqual([
      "RL_ADMIN_PASSWORD='***' CI=1 SLOT=2 ./go.sh",
    ]);
    expect(redactCmd(['CI=1', 'RL_AGENT_ID=deadbeef', 'npm run build'])).toEqual([
      'CI=1',
      'RL_AGENT_ID=deadbeef',
      'npm run build',
    ]);
  });

  it('is a pure function — the input array is not mutated', () => {
    const input = [`ADMIN_PASSWORD='${SECRET}'`];
    const out = redactCmd(input);
    expect(input[0]).toContain(SECRET);
    expect(out[0]).not.toContain(SECRET);
  });
});

describe('brief mode must not starve the wait path (ROK-1567 regression)', () => {
  it('keeps the M5b liveness fields in a brief read', async () => {
    execFileOk({
      ...taskJson('running'),
      last_output_at: '2026-09-14T10:04:58.123Z',
      last_line: '[heartbeat] elapsed=240s',
      progress_hint: 'jest: suite 12 of 18',
    });
    const r = (await executeStatus({ task_id: 'abc12345' })) as unknown as Record<string, unknown>;
    expect(
      r.progress_hint,
      'a brief poll that cannot distinguish "working" from "hung" is useless',
    ).toBe('jest: suite 12 of 18');
    expect(r.last_output_at).toBe('2026-09-14T10:04:58.123Z');
    expect(r.last_line).toBe('[heartbeat] elapsed=240s');
  });

  it('executeWait still reads the FULL payload — log_tail survives to the snapshot', async () => {
    // probe (inotifywait present) -> pre-check read of a RUNNING task
    execFileOk({ ok: true });
    execFileOk(taskJson('running'));
    mockExecFile.mockImplementationOnce(() => {
      /* hang: force the cap-expiry path */
    });
    execFileOk(taskJson('running')); // cap-expiry snapshot read
    const r = (await executeWait({ task_id: 'abc12345', timeout_seconds: 5 })) as unknown as Record<
      string,
      unknown
    >;
    expect(
      (r.log_tail as string)?.length,
      'brief mode must NOT leak into rl_task_wait — the still_running snapshot carries ~6KB of log',
    ).toBeGreaterThan(0);
  }, 15_000);
});

describe('brief mode vs include_credentials (review MAJOR 2)', () => {
  const SECRET_PW = 'rl-deadbeefcafe0001';
  const runningLocal = {
    ok: true,
    task_id: 'local-3f9a2c1b8d04',
    tool: 'rl_env_deploy',
    slot: 2,
    mcp_runtime_status: 'running',
    current_step: 'compose up',
    steps: [],
    url: 'https://slot-2.gamernight.net',
    slot_url: 'https://slot-2.gamernight.net',
    admin_email: 'admin@local',
    admin_password: SECRET_PW,
  };

  it('include_credentials:true on a RUNNING local task still returns the password', async () => {
    const r = applyStatusProjection({ ...runningLocal }, undefined, true) as Record<
      string,
      unknown
    >;
    expect(
      r.admin_password,
      'an explicit A3-B opt-in must not be silently eaten by brief mode',
    ).toBe(SECRET_PW);
  });

  it('without the opt-in, a brief read still carries the presence marker and the env URLs', () => {
    const r = applyStatusProjection(
      {
        ...runningLocal,
        admin_password: undefined,
        admin_password_available: true,
        admin_password_hint: 'ask with include_credentials:true',
      },
      undefined,
      false,
    ) as Record<string, unknown>;
    expect(r.admin_password_available).toBe(true);
    expect(r.admin_password_hint).toBe('ask with include_credentials:true');
    expect(r.url).toBe('https://slot-2.gamernight.net');
    expect(r.slot_url).toBe('https://slot-2.gamernight.net');
    expect(r.admin_email).toBe('admin@local');
    expect('log_tail' in r, 'it is still a brief read').toBe(false);
  });
});
