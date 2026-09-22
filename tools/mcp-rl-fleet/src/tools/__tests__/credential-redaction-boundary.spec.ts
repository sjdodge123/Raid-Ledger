// A3-B P4 — the MCP return boundary must not hand an agent the fleet
// admin@local password it never asked for.
//
// credentials.spec.ts covers the redactor in isolation; this file pins the two
// remaining CARRIER TOOLS to it, because the defect was never in the helper —
// it was that these executors returned the orchestrator's payload verbatim.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runRl = vi.fn();
const execFileP = vi.fn();
vi.mock('../../exec.js', () => ({
  runRl: (...a: unknown[]) => runRl(...a),
  parseJsonFromStdout: (s: string) => {
    try {
      return JSON.parse(s.trim()) as unknown;
    } catch {
      return null;
    }
  },
  buildSshArgs: vi.fn(async () => ['rl-agent@host', 'noop']),
  classifySshFailure: vi.fn(() => null),
  execFileP: (...a: unknown[]) => execFileP(...a),
  shellQuote: (s: string) => `'${s}'`,
  synthesizeEmptyStderrDiagnostic: () => '',
}));

const readRawLocalTask = vi.fn();
vi.mock('../../local-task.js', () => ({
  isLocalTaskId: (id: string) => id.startsWith('local-'),
  readRawLocalTask: (...a: unknown[]) => readRawLocalTask(...a),
  readLocalTask: vi.fn(),
  waitLocalTask: vi.fn(),
  cancelLocalTask: vi.fn(),
  localLogPath: (id: string) => `/tmp/${id}.log`,
}));

import * as envSpin from '../env-spin.js';
import * as taskInspect from '../task-inspect.js';
import { executeList, executeStatus } from '../task.js';

const SECRET = 'rl-0badc0ffee123456';

const SPIN_JSON = JSON.stringify({
  ok: true,
  slug: 'rok-test',
  url: 'https://slot-2.gamernight.net',
  admin_email: 'admin@local',
  admin_password: SECRET,
  bootstrap_warnings: [],
});

beforeEach(() => {
  runRl.mockReset();
  readRawLocalTask.mockReset();
  execFileP.mockReset();
  runRl.mockResolvedValue({ stdout: SPIN_JSON, stderr: '', exitCode: 0 });
});

describe('rl_env_spin — credential boundary', () => {
  it('does NOT return admin_password when the caller did not ask for it', async () => {
    const r = await envSpin.execute({ slug: 'rok-test' });
    expect(
      r.admin_password,
      `spinning an env must not put the credential in the caller's context — expected undefined, got ${JSON.stringify(r.admin_password)}`,
    ).toBeUndefined();
    expect(
      JSON.stringify(r).includes(SECRET),
      `the secret must not survive anywhere in the rl_env_spin payload — expected false, got true for ${JSON.stringify(r)}`,
    ).toBe(false);
  });

  it('reports that a password exists, and keeps url/admin_email intact', async () => {
    const r = await envSpin.execute({ slug: 'rok-test' });
    expect(
      r.admin_password_available,
      `the caller still needs to know the env HAS a usable admin login — expected true, got ${JSON.stringify(r.admin_password_available)}`,
    ).toBe(true);
    expect(r.url, 'url must survive redaction — expected the slot URL').toBe(
      'https://slot-2.gamernight.net',
    );
    expect(r.admin_email, 'admin_email is not a credential — expected admin@local').toBe(
      'admin@local',
    );
  });

  it('preserves the bootstrap-failure signal that admin_password:null used to carry', async () => {
    runRl.mockResolvedValue({
      stdout: JSON.stringify({
        ok: true,
        slug: 'rok-test',
        admin_password: null,
        bootstrap_warnings: [{ code: 'admin_bootstrap_failed', detail: 'container not healthy' }],
      }),
      stderr: '',
      exitCode: 0,
    });
    const r = await envSpin.execute({ slug: 'rok-test' });
    expect(
      r.admin_password_available,
      `a failed bootstrap must surface as available:false, not as a missing key — got ${JSON.stringify(r.admin_password_available)}`,
    ).toBe(false);
    expect(r.bootstrap_warnings?.[0]?.code).toBe('admin_bootstrap_failed');
  });

  it('returns the value when include_credentials:true is passed explicitly', async () => {
    const r = await envSpin.execute({ slug: 'rok-test', include_credentials: true });
    expect(
      r.admin_password,
      `the explicit opt-in must still work — expected ${SECRET}, got ${JSON.stringify(r.admin_password)}`,
    ).toBe(SECRET);
  });
});

describe('rl_task_inspect — credential boundary', () => {
  const rawTask = {
    task_id: 'local-3f9a2c1b8d04',
    tool: 'rl_env_deploy',
    mcp_runtime_status: 'succeeded',
    url: 'https://slot-2.gamernight.net',
    admin_email: 'admin@local',
    admin_password: SECRET,
  };

  it('withholds admin_password from the "full raw dump" by default', async () => {
    readRawLocalTask.mockReturnValue(rawTask);
    const r = await taskInspect.execute({ task_id: 'local-3f9a2c1b8d04' });
    expect(
      r.task?.admin_password,
      `a forensic dump must still stop at the credential — expected undefined, got ${JSON.stringify(r.task?.admin_password)}`,
    ).toBeUndefined();
    expect(
      JSON.stringify(r).includes(SECRET),
      `the secret must not survive anywhere in the rl_task_inspect payload — expected false, got true for ${JSON.stringify(r)}`,
    ).toBe(false);
    expect(
      r.task?.admin_password_available,
      `inspect must still report the credential's existence — expected true, got ${JSON.stringify(r.task?.admin_password_available)}`,
    ).toBe(true);
    expect(r.task?.url, 'every non-credential field stays verbatim').toBe(
      'https://slot-2.gamernight.net',
    );
  });

  it('returns it when include_credentials:true is passed explicitly', async () => {
    readRawLocalTask.mockReturnValue(rawTask);
    const r = await taskInspect.execute({
      task_id: 'local-3f9a2c1b8d04',
      include_credentials: true,
    });
    expect(
      r.task?.admin_password,
      `the explicit opt-in must still work — expected ${SECRET}, got ${JSON.stringify(r.task?.admin_password)}`,
    ).toBe(SECRET);
  });
});

// ---------------------------------------------------------------------------
// ROK-1534 — the credential also rides in `cmd`, and two tools never redacted
// anything at all.
//
// A3-B withholds `admin_password` as a FIELD. It said nothing about the
// command line, and `rl_validate_ci({against_env_slug})` threads the env admin
// password into the runner as an `ADMIN_PASSWORD='…'` env prefix. So the value
// A3-B withholds from `rl_env_spin` came straight back out of:
//   * rl_task_inspect — VM path returned the orchestrator JSON VERBATIM;
//   * rl_task_inspect — local path redacted the field but not `cmd`;
//   * rl_task_list    — returned every task record whole.
// Every assertion below reads the ACTUAL returned payload. A test that only
// proves "a redactor was called" would pass against the broken code.
// ---------------------------------------------------------------------------

const BOT_TOKEN = 'MTA5OTg4.Gx1234.aBcDeFgHiJkLmNoPqRsTuVwXyZ';

/** A VM task record as the orchestrator writes it for an env-targeted run. */
function vmTaskJson(): Record<string, unknown> {
  return {
    ok: true,
    task_id: 'c1f8c50fef1c',
    tool: 'rl_validate_ci',
    slot: 2,
    status: 'succeeded',
    mcp_runtime_status: 'succeeded',
    args_summary: `validate-ci --only-e2e ADMIN_PASSWORD='${SECRET}'`,
    cmd: [
      'bash',
      '-lc',
      `BASE_URL='https://slot-2.gamernight.net' ADMIN_PASSWORD='${SECRET}' ./scripts/validate-ci.sh --only-e2e`,
    ],
    env: { RL_AGENT_ID: 'deadbeef', ADMIN_PASSWORD: SECRET, DISCORD_BOT_TOKEN: BOT_TOKEN },
    cwd: '/workspace',
    steps: [],
  };
}

function sshOk(stdout: unknown): void {
  execFileP.mockResolvedValueOnce({ stdout: JSON.stringify(stdout), stderr: '' });
}

describe('rl_task_inspect — ROK-1534 command-line credential boundary', () => {
  it('redacts ADMIN_PASSWORD out of cmd/args_summary/env on the VM path', async () => {
    sshOk(vmTaskJson());
    const r = await taskInspect.execute({ task_id: 'c1f8c50fef1c' });
    const payload = JSON.stringify(r);
    expect(
      payload.includes(SECRET),
      `rl_task_inspect must not echo the env admin password anywhere — expected false, got true for ${payload}`,
    ).toBe(false);
    expect(
      payload.includes(BOT_TOKEN),
      `a bot token in the task env is the same class of secret — expected false, got true for ${payload}`,
    ).toBe(false);
    const cmd = r.task?.cmd as string[];
    expect(
      cmd[2],
      `the command must stay READABLE with only the value masked — got ${cmd[2]}`,
    ).toBe(
      "BASE_URL='https://slot-2.gamernight.net' ADMIN_PASSWORD='***' ./scripts/validate-ci.sh --only-e2e",
    );
    expect(r.task?.cwd, 'non-secret forensic fields stay verbatim — expected /workspace').toBe(
      '/workspace',
    );
    expect(r.task?.tool, 'tool must survive redaction').toBe('rl_validate_ci');
  });

  it('keeps cmd redacted even under include_credentials:true', async () => {
    sshOk(vmTaskJson());
    const r = await taskInspect.execute({ task_id: 'c1f8c50fef1c', include_credentials: true });
    expect(
      JSON.stringify(r).includes(SECRET),
      'include_credentials opts into the admin_password FIELD, never into the command line',
    ).toBe(false);
  });

  it('redacts cmd on the local- path too, not just the admin_password field', async () => {
    readRawLocalTask.mockReturnValue({
      task_id: 'local-3f9a2c1b8d04',
      tool: 'rl_env_deploy',
      admin_password: SECRET,
      args_summary: `env-deploy ADMIN_PASSWORD='${SECRET}'`,
      cmd: ['bash', '-lc', `ADMIN_PASSWORD='${SECRET}' ./scripts/deploy_dev.sh`],
    });
    const r = await taskInspect.execute({ task_id: 'local-3f9a2c1b8d04' });
    expect(
      JSON.stringify(r).includes(SECRET),
      `the local raw dump leaked the credential through cmd — expected false, got true for ${JSON.stringify(r)}`,
    ).toBe(false);
  });
});

describe('rl_task_list — ROK-1534 credential boundary', () => {
  it('redacts every listed task record, not just the one you polled', async () => {
    sshOk({ ok: true, tasks: [vmTaskJson(), vmTaskJson()] });
    const r = await executeList({ limit: 2 });
    const payload = JSON.stringify(r);
    expect(
      payload.includes(SECRET),
      `one rl_task_list call leaked what 50 rl_task_status polls could not — expected false, got true for ${payload}`,
    ).toBe(false);
    expect(r.tasks?.length, 'redaction must not drop rows — expected 2').toBe(2);
    expect(
      (r.tasks?.[0] as { cwd?: string }).cwd,
      'non-secret fields survive — expected /workspace',
    ).toBe('/workspace');
  });
});

describe('rl_task_status — ROK-1534 widened secret class', () => {
  it('masks *_TOKEN / *_SECRET assignments, not only *ADMIN_PASSWORD', async () => {
    sshOk({
      ...vmTaskJson(),
      cmd: ['bash', '-lc', `DISCORD_BOT_TOKEN='${BOT_TOKEN}' JWT_SECRET="${SECRET}" ./run.sh`],
    });
    const r = (await executeStatus({ task_id: 'c1f8c50fef1c' })) as unknown as Record<
      string,
      unknown
    >;
    const payload = JSON.stringify(r);
    expect(
      payload.includes(BOT_TOKEN),
      `a *_TOKEN assignment is the same leak as *_PASSWORD — expected false, got true for ${payload}`,
    ).toBe(false);
    expect(
      payload.includes(SECRET),
      `a *_SECRET assignment is the same leak — expected false, got true for ${payload}`,
    ).toBe(false);
    expect((r.cmd as string[])[2]).toBe("DISCORD_BOT_TOKEN='***' JWT_SECRET='***' ./run.sh");
  });
});
