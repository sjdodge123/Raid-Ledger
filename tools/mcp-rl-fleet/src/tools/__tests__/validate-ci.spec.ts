// ROK-1331 M2 — rl_validate_ci async-by-default + wait:true chaining + Bug C.
// Stubs the child_process boundary so neither SSH nor rl CLI run.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: (...args: unknown[]) => mockExecFile(...args),
  default: {
    execFile: (...args: unknown[]) => mockExecFile(...args),
    execFileSync: (...args: unknown[]) => mockExecFile(...args),
  },
}));

import * as validateCi from '../validate-ci.js';
import * as envDeploy from '../env-deploy.js';
import * as release from '../release.js';

function execFileOk(stdout: string | object): void {
  const payload = typeof stdout === 'string' ? stdout : JSON.stringify(stdout);
  mockExecFile.mockImplementationOnce(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      callback(null, payload, '');
    },
  );
}

/** Capture every execFile call's argv for assertions. */
function execFileAlwaysOk(stdoutResolver: (cmd: string, args: string[]) => unknown): void {
  mockExecFile.mockImplementation(
    (
      cmd: string,
      args: string[],
      _opts: unknown,
      cb: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const callback = typeof _opts === 'function' ? (_opts as typeof cb) : cb;
      const payload = stdoutResolver(cmd, args);
      const out = typeof payload === 'string' ? payload : JSON.stringify(payload);
      callback(null, out, '');
    },
  );
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('AC1 — rl_validate_ci async-by-default returns task_id within 1s', () => {
  it('with wait:false returns {ok:true, task_id, log_url, started_at} quickly', async () => {
    // Slot resolution (rl status --json) returns slot 1.
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rev-parse')) return ''; // git probes
      if (argv.includes('show-current')) return '';
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent', branch: 'rok-1331' }] };
      }
      // task-start returns {ok, task_id, log_path, started_at}
      return {
        ok: true,
        task_id: 'abcd1234',
        log_path: '/srv/rl-infra/state/tasks/abcd1234.log',
        started_at: '2026-05-20T12:00:00.000Z',
      };
    });
    const t0 = Date.now();
    const result = (await validateCi.execute({
      args: ['--no-e2e'],
      wait: false,
    })) as validateCi.ValidateCiAsyncResult;
    const elapsed = Date.now() - t0;
    expect(result.ok).toBe(true);
    expect(result.task_id).toMatch(/^[a-z0-9]{8,32}$/);
    expect(result.log_url).toContain(result.task_id ?? '');
    expect(result.started_at).toBeTruthy();
    // Mocked path — must be far under 1s.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('AC9 — wait:true chains internally to executeWait (sync shape preserved)', () => {
  it('returns full validate-ci output when wait:true (mocked task-status reports terminal)', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      if (argv.includes('task-start')) {
        return {
          ok: true,
          task_id: 'waitable1',
          log_path: '/srv/rl-infra/state/tasks/waitable1.log',
          started_at: '2026-05-20T12:00:00.000Z',
        };
      }
      // task-status (called via executeWait → executeStatus)
      return {
        ok: true,
        task_id: 'waitable1',
        tool: 'rl_validate_ci',
        slot: 1,
        args_summary: '--no-e2e',
        started_at: '2026-05-20T12:00:00.000Z',
        finished_at: '2026-05-20T12:05:00.000Z',
        elapsed_seconds: 300,
        mcp_runtime_status: 'succeeded',
        script_exit_code: 0,
        steps: [{ name: 'Build (all workspaces)', status: 'PASS', duration_s: 45 }],
        log_tail: '',
        log_url: 'https://fleet.gamernight.net/api/tasks/waitable1/log',
        log_path: '/srv/rl-infra/state/tasks/waitable1.log',
      };
    });
    const result = await validateCi.execute({ args: ['--no-e2e'], wait: true });
    // wait:true should return the resolved status (mcp_runtime_status terminal).
    expect((result as { mcp_runtime_status?: string }).mcp_runtime_status).toBe('succeeded');
  });
});

describe('default wait_timeout_seconds is 120 (ROK-1362 hard cap)', () => {
  // ROK-1362 — the shared waitFragment now caps at 120s and defaults to 120.
  it('schema defaults wait_timeout_seconds to 120 and rejects >120', () => {
    const schema = z.object({
      wait: z.boolean().optional(),
      wait_timeout_seconds: z.number().int().min(5).max(120).default(120),
    });
    expect(schema.parse({ wait: true }).wait_timeout_seconds).toBe(120);
    expect(() => schema.parse({ wait: true, wait_timeout_seconds: 1800 })).toThrow();
  });
});

describe('Bug C — validate-ci.ts invokes target via `bash <script>` (not bare path)', () => {
  it('SSH remote command starts the script with `bash /workspace/scripts/validate-ci.sh`', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      return { ok: true, task_id: 'bugc0001', started_at: '2026-05-20T12:00:00.000Z' };
    });
    await validateCi.execute({ args: [], wait: false });
    // Find the task-start SSH call's argv and assert `bash /workspace/scripts/validate-ci.sh`.
    const sshCall = mockExecFile.mock.calls.find((call: unknown[]) => {
      const a = call[1] as string[];
      return Array.isArray(a) && a.some((s) => typeof s === 'string' && s.includes('task-start'));
    });
    expect(sshCall, 'expected an SSH argv containing task-start').toBeTruthy();
    const argvStr = JSON.stringify(sshCall![1]);
    expect(argvStr).toContain('bash');
    expect(argvStr).toContain('/workspace/scripts/validate-ci.sh');
    // Confirm it is NOT invoking the script directly without bash.
    expect(argvStr).not.toMatch(/-- \/workspace\/scripts\/validate-ci\.sh/);
  });
});

describe('Bug D (Session 4 dogfood) — targetCmd routes through run-on-runner', () => {
  // task-start runs the wrapped cmd on the HOST. validate-ci.sh lives inside
  // the runner container at /workspace, so the targetCmd MUST first `docker
  // exec` into the container via run-on-runner. Without this wrap the M2
  // async path returns script_exit_code:127 immediately.
  it('SSH argv contains `run-on-runner` before the inner bash invocation', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      return { ok: true, task_id: 'bugd0001', started_at: '2026-05-20T12:00:00.000Z' };
    });
    await validateCi.execute({ args: ['--no-e2e'], wait: false });
    const sshCall = mockExecFile.mock.calls.find((call: unknown[]) => {
      const a = call[1] as string[];
      return Array.isArray(a) && a.some((s) => typeof s === 'string' && s.includes('task-start'));
    });
    const argvStr = JSON.stringify(sshCall![1]);
    expect(argvStr).toContain('/srv/rl-infra/orchestrator/bin/run-on-runner-with-heartbeat');
    // run-on-runner must precede the `bash /workspace/...` so that the
    // bash subshell executes INSIDE the container.
    const runIdx = argvStr.indexOf('run-on-runner-with-heartbeat');
    const bashIdx = argvStr.indexOf('/workspace/scripts/validate-ci.sh');
    expect(runIdx).toBeGreaterThan(-1);
    expect(bashIdx).toBeGreaterThan(runIdx);
  });

  it('against_env_slug env vars are wrapped inside the bash -c subshell', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      return { ok: true, task_id: 'bugd0002', started_at: '2026-05-20T12:00:00.000Z' };
    });
    await validateCi.execute({
      args: ['--only-e2e'],
      against_env_slug: 'demo',
      wait: false,
    });
    const sshCall = mockExecFile.mock.calls.find((call: unknown[]) => {
      const a = call[1] as string[];
      return Array.isArray(a) && a.some((s) => typeof s === 'string' && s.includes('task-start'));
    });
    const argvStr = JSON.stringify(sshCall![1]);
    // The env-vars block must live INSIDE the bash -c quoted payload, not
    // outside (where it would only apply to the HOST run-on-runner process
    // and never cross the docker exec boundary).
    expect(argvStr).toContain('bash -c');
    expect(argvStr).toContain('BASE_URL');
    const bashCIdx = argvStr.indexOf('bash -c');
    const baseUrlIdx = argvStr.indexOf('BASE_URL');
    expect(baseUrlIdx).toBeGreaterThan(bashCIdx);
  });
});

describe('ROK-1368 — against_env_slug threads the re-seeded ADMIN_PASSWORD', () => {
  it('exports ADMIN_PASSWORD matching the env-reseed output inside bash -c', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      // The re-seed SSH call echoes the password it set.
      if (argv.includes('bootstrap-admin') || argv.includes('RL_SEEDED_PW')) {
        return 'RL_SEEDED_PW=rl-ci-deadbeef';
      }
      return { ok: true, task_id: 'pw000001', started_at: '2026-05-20T12:00:00.000Z' };
    });
    await validateCi.execute({
      args: ['--only-e2e'],
      against_env_slug: 'demo',
      wait: false,
    });
    const sshCall = mockExecFile.mock.calls.find((call: unknown[]) => {
      const a = call[1] as string[];
      return Array.isArray(a) && a.some((s) => typeof s === 'string' && s.includes('task-start'));
    });
    const argvStr = JSON.stringify(sshCall![1]);
    expect(argvStr).toContain('ADMIN_PASSWORD=');
    expect(argvStr).toContain('rl-ci-deadbeef');
    const bashCIdx = argvStr.indexOf('bash -c');
    const pwIdx = argvStr.indexOf('ADMIN_PASSWORD=');
    expect(pwIdx).toBeGreaterThan(bashCIdx);
  });

  it('omits ADMIN_PASSWORD on the laptop-local path (no against_env_slug)', async () => {
    execFileAlwaysOk((_cmd: string, args: string[]) => {
      const argv = args.join(' ');
      if (argv.includes('rl status')) {
        return { slots: [{ slot: 1, claimed_by: 'this-agent' }] };
      }
      return { ok: true, task_id: 'pw000002', started_at: '2026-05-20T12:00:00.000Z' };
    });
    await validateCi.execute({ args: ['--only-e2e'], wait: false });
    const sshCall = mockExecFile.mock.calls.find((call: unknown[]) => {
      const a = call[1] as string[];
      return Array.isArray(a) && a.some((s) => typeof s === 'string' && s.includes('task-start'));
    });
    expect(JSON.stringify(sshCall![1])).not.toContain('ADMIN_PASSWORD=');
  });
});

describe('rl_env_deploy is now ASYNC by default (ROK-1362)', () => {
  it('TOOL_DESCRIPTION documents the async task_id + polling pattern', () => {
    // ROK-1362 inverted the old "this tool is SYNC" contract: env_deploy now
    // returns a local-... task_id and the description must teach polling.
    expect(envDeploy.TOOL_DESCRIPTION).toMatch(/ASYNC BY DEFAULT/);
    expect(envDeploy.TOOL_DESCRIPTION).toMatch(/task_id:'local-\.\.\.'|local-\.\.\./);
    expect(envDeploy.TOOL_DESCRIPTION).toMatch(/rl_task_status|rl_task_wait/);
    // The old SYNC boast is gone.
    expect(envDeploy.TOOL_DESCRIPTION).not.toMatch(/this tool is SYNC/);
  });

  it('accepts wait / wait_timeout_seconds (≤120) at the schema boundary', () => {
    // Mirrors index.ts envDeploySchema's waitFragment.
    const schema = z
      .object({
        slug: z.string().regex(/^[a-z0-9-]+$/),
        wait: z.boolean().optional(),
        wait_timeout_seconds: z.number().int().min(5).max(120).default(120),
      })
      .strict();
    expect(schema.parse({ slug: 'foo', wait: false }).wait_timeout_seconds).toBe(120);
    expect(() => schema.parse({ slug: 'foo', wait_timeout_seconds: 1800 })).toThrow();
  });
});

describe('rl_release returns cancelled_tasks: string[]', () => {
  it('parses cancelled_tasks from orchestrator release output', async () => {
    execFileOk({
      ok: true,
      slot: 1,
      destroyed_envs: [],
      cancelled_tasks: ['abc123def', 'task222zz'],
    });
    const result = await release.execute({});
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.cancelled_tasks)).toBe(true);
    expect(result.cancelled_tasks).toEqual(['abc123def', 'task222zz']);
  });

  it('returns cancelled_tasks: [] (empty, not omitted) when no in-flight tasks', async () => {
    execFileOk({ ok: true, slot: 1, destroyed_envs: [], cancelled_tasks: [] });
    const result = await release.execute({});
    expect(result.cancelled_tasks).toEqual([]);
  });
});
