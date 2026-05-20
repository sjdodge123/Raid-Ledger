// ROK-1331 M7 — rl_fleet_health MCP tool tests.
//
// The tool SSHes to the rl-infra VM and curls the dashboard's /api/fleet-health
// endpoint via the rl-net curl-on-VM pattern (same as test-plan.ts). We mock
// the child_process boundary so neither SSH nor docker actually runs, and
// assert on (a) argv shape (URL path + method) and (b) response parsing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastExecFileArgs: { file: string; args: string[] } | null = null;
let nextStdout = '';
let nextStderr = '';
let nextErr: Error | null = null;

vi.mock('node:child_process', () => {
  return {
    execFile: (
      file: string,
      args: string[],
      _opts: unknown,
      cb: (
        err: Error | null,
        result: { stdout: string; stderr: string } | null,
      ) => void,
    ) => {
      lastExecFileArgs = { file, args };
      if (nextErr) cb(nextErr, null);
      else cb(null, { stdout: nextStdout, stderr: nextStderr });
      return { kill: () => undefined };
    },
    spawn: vi.fn(),
  };
});

beforeEach(() => {
  lastExecFileArgs = null;
  nextStdout = '';
  nextStderr = '';
  nextErr = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

const CLEAN_FLEET = {
  generated_at: '2026-05-20T14:00:00.000Z',
  stale_heartbeat_slots: [],
  queue_stuck: [],
  runner_warnings: [],
  recent_audit_errors: [
    { category: 'permission_denied', count: 0, last_seen: null, sample: '' },
    { category: 'exit_255', count: 0, last_seen: null, sample: '' },
  ],
  summary: { ok: true, warning_count: 0, stale_slots: 0, stuck_queue_entries: 0 },
};

describe('rl_fleet_health — wire shape', () => {
  it('SSHes the VM and curls /api/fleet-health via rl-net', async () => {
    nextStdout = `${JSON.stringify(CLEAN_FLEET)}\nRL_STATUS:200`;
    const { execute } = await import('../fleet-health.js');
    const result = await execute({});

    expect(lastExecFileArgs).not.toBeNull();
    expect(lastExecFileArgs!.file).toBe('ssh');
    // ssh argv: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'user@host', '<remote-cmd>']
    const remoteCmd = lastExecFileArgs!.args[lastExecFileArgs!.args.length - 1];
    expect(remoteCmd).toContain('docker run');
    expect(remoteCmd).toContain('--network rl-net');
    expect(remoteCmd).toContain('curlimages/curl');
    expect(remoteCmd).toContain('/api/fleet-health');
    // GET is the only method this endpoint supports.
    expect(remoteCmd).toContain('-X GET');

    // Response parsed cleanly.
    expect(result.ok).toBe(true);
    expect(result.summary?.ok).toBe(true);
    expect(Array.isArray(result.recent_audit_errors)).toBe(true);
  });

  it('returns parsed body on 200', async () => {
    const fleetWithFindings = {
      ...CLEAN_FLEET,
      stale_heartbeat_slots: [
        { slot: 1, agent_id: 'a1', branch: 'rok-x', heartbeat_age_seconds: 600 },
      ],
      summary: { ok: false, warning_count: 1, stale_slots: 1, stuck_queue_entries: 0 },
    };
    nextStdout = `${JSON.stringify(fleetWithFindings)}\nRL_STATUS:200`;

    const { execute } = await import('../fleet-health.js');
    const result = await execute({});
    expect(result.ok).toBe(true);
    expect(result.stale_heartbeat_slots).toEqual(fleetWithFindings.stale_heartbeat_slots);
    expect(result.summary).toEqual(fleetWithFindings.summary);
  });

  it('returns an error envelope on non-200 status', async () => {
    nextStdout = '<html>500</html>\nRL_STATUS:500';
    const { execute } = await import('../fleet-health.js');
    const result = await execute({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('dashboard_http_error');
    expect(result.status).toBe(500);
  });

  it('returns an error envelope on ssh exec failure', async () => {
    nextErr = Object.assign(new Error('ssh failed'), { code: 255 });
    const { execute } = await import('../fleet-health.js');
    const result = await execute({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ssh_failed');
  });

  it('returns parse error envelope when body is unparseable', async () => {
    nextStdout = 'this is not json\nRL_STATUS:200';
    const { execute } = await import('../fleet-health.js');
    const result = await execute({});
    expect(result.ok).toBe(false);
    expect(result.error).toBe('failed_to_parse_response');
  });
});

describe('rl_fleet_health — schema introspection', () => {
  it('exports TOOL_NAME + TOOL_DESC for index.ts registration', async () => {
    const mod = await import('../fleet-health.js');
    expect(mod.TOOL_NAME).toBe('rl_fleet_health');
    expect(typeof mod.TOOL_DESC).toBe('string');
    expect(mod.TOOL_DESC.length).toBeGreaterThan(20);
  });
});
