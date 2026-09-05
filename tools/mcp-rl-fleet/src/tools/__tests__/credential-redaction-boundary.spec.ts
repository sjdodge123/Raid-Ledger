// A3-B P4 — the MCP return boundary must not hand an agent the fleet
// admin@local password it never asked for.
//
// credentials.spec.ts covers the redactor in isolation; this file pins the two
// remaining CARRIER TOOLS to it, because the defect was never in the helper —
// it was that these executors returned the orchestrator's payload verbatim.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  buildSshArgs: vi.fn(async () => ['rl-agent@host', 'noop']),
  classifySshFailure: vi.fn(() => null),
  execFileP: vi.fn(),
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
