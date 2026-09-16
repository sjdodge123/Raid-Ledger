// ROK-1568 — rl_fleet_prune MCP tool tests.
//
// The tool SSHes the rl-infra VM and runs the SAME disk-pressure ladder the
// gc-sweeper runs (orchestrator/bin/_disk_pressure.sh), so an agent that finds
// the host wedged at 98% can reclaim without the operator pruning by hand.
// We mock the child_process boundary: neither SSH nor docker actually runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let lastExecFileArgs: { file: string; args: string[] } | null = null;
let nextStdout = '';
let nextErr: Error | null = null;

vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, result: { stdout: string; stderr: string } | null) => void,
  ) => {
    lastExecFileArgs = { file, args };
    if (nextErr) cb(nextErr, null);
    else cb(null, { stdout: nextStdout, stderr: '' });
    return { kill: () => undefined };
  },
  spawn: vi.fn(),
}));

beforeEach(() => {
  lastExecFileArgs = null;
  nextStdout = '';
  nextErr = null;
});
afterEach(() => vi.clearAllMocks());

/**
 * The remote script travels base64-encoded (review BLOCKER 2 — the inlined
 * `bash -c '…'` form was broken by its own nested quotes). Assertions must
 * therefore decode, not `.contains()` the argv, or they pass vacuously against
 * a command the remote shell cannot even parse.
 */
const decodeRemoteScript = (args: string[] | undefined): string => {
  const m = /echo ([A-Za-z0-9+/=]+) \| base64 -d/.exec((args ?? []).join(' '));
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
};

const LADDER_RESULT = {
  before_pct: 98,
  after_pct: 39,
  free_gb_before: 5,
  free_gb: 149,
  pruned: true,
  dry_run: false,
  rungs: [
    { rung: 'builder_prune', before_pct: 98, after_pct: 74, reclaimed: '60GB' },
    { rung: 'image_prune', before_pct: 74, after_pct: 68, reclaimed: '13GB' },
    { rung: 'volume_prune', before_pct: 68, after_pct: 39, reclaimed: '14.5GB' },
  ],
};

describe('rl_fleet_prune', () => {
  it('runs the shared ladder over SSH and maps before/after/rungs', async () => {
    const { execute } = await import('../fleet-prune.js');
    nextStdout = `${JSON.stringify(LADDER_RESULT)}\n`;

    const res = await execute({});

    expect(res.ok).toBe(true);
    expect(res.before).toEqual({ used_pct: 98, free_gb: 5 });
    expect(res.after).toEqual({ used_pct: 39, free_gb: 149 });
    expect(res.rungs).toHaveLength(3);
    expect(res.rungs?.[2]).toMatchObject({ rung: 'volume_prune', reclaimed: '14.5GB' });
    // "14.5GB" must reach the agent as a number it can compare, too.
    expect(res.rungs?.[2].reclaimed_bytes).toBe(Math.round(14.5 * 1000 ** 3));

    expect(lastExecFileArgs?.file).toBe('ssh');
    const script = decodeRemoteScript(lastExecFileArgs?.args);
    expect(script).toContain('_disk_pressure.sh');
    expect(script).toContain('disk_pressure::guard');
    // The ladder's own threshold must be bypassed: an agent asking to prune
    // has already decided, and the target stop-rule still bounds the work.
    expect(script).toContain('RL_DISK_PRUNE_PCT=0');
    expect(script).toContain('RL_DISK_PRUNE_DRY_RUN=0');
  });

  it('dry-run lists the rungs it would run and prunes nothing', async () => {
    const { execute } = await import('../fleet-prune.js');
    nextStdout = `${JSON.stringify({
      before_pct: 91,
      after_pct: 91,
      free_gb_before: 22,
      free_gb: 22,
      pruned: false,
      dry_run: true,
      rungs: [
        { rung: 'builder_prune', command: 'docker builder prune -af', would_run: true },
        { rung: 'image_prune', command: 'docker image prune -af', would_run: true },
        { rung: 'volume_prune', command: 'docker volume prune -f', would_run: true },
      ],
    })}\nRL_SYSTEM_DF:[{"Type":"Build Cache","Reclaimable":"60GB"}]\n`;

    const res = await execute({ dry_run: true });

    expect(res.ok).toBe(true);
    expect(res.dry_run).toBe(true);
    expect(res.pruned).toBe(false);
    expect(res.rungs?.every((r) => r.would_run)).toBe(true);
    expect(res.system_df).toEqual([{ Type: 'Build Cache', Reclaimable: '60GB' }]);
    expect(decodeRemoteScript(lastExecFileArgs?.args)).toContain('RL_DISK_PRUNE_DRY_RUN=1');
  });

  it('reports a refused rung as a failure instead of a 0B success', async () => {
    const { execute } = await import('../fleet-prune.js');
    // What rl-docker-proxy returns for a route missing from allowPOST: docker
    // exits non-zero, prints no "Total reclaimed space", and the ladder scores
    // "0B" — which used to come back as ok:true, pruned:true (review MAJOR 3).
    nextStdout = `${JSON.stringify({
      before_pct: 98,
      after_pct: 98,
      free_gb_before: 5,
      free_gb: 5,
      pruned: true,
      dry_run: false,
      rungs: [
        {
          rung: 'builder_prune',
          before_pct: 98,
          after_pct: 98,
          reclaimed: '0B',
          exit_code: 1,
          stderr: 'Error response from daemon: 403 Forbidden',
        },
        { rung: 'image_prune', before_pct: 98, after_pct: 98, reclaimed: '0B', exit_code: 0, stderr: '' },
      ],
    })}\n`;

    const res = await execute({});

    expect(res.ok).toBe(false);
    expect(res.error).toBe('prune_rung_failed');
    expect(res.message).toContain('builder_prune');
    expect(res.message).toContain('403');
    // The numbers still come back so the agent can see nothing was reclaimed.
    expect(res.after).toEqual({ used_pct: 98, free_gb: 5 });
    expect(res.rungs).toHaveLength(2);
  });

  it('reports ssh_failed instead of throwing when the VM is unreachable', async () => {
    const { execute } = await import('../fleet-prune.js');
    nextErr = Object.assign(new Error('ssh: connect: host is down'), { code: 255 });

    const res = await execute({});

    expect(res.ok).toBe(false);
    expect(res.error).toBe('ssh_failed');
    expect(res.message).toContain('host is down');
  });

  it('surfaces unparseable output rather than pretending the prune worked', async () => {
    const { execute } = await import('../fleet-prune.js');
    nextStdout = 'bash: _disk_pressure.sh: No such file or directory\n';

    const res = await execute({});

    expect(res.ok).toBe(false);
    expect(res.error).toBe('failed_to_parse_response');
    expect(res.message).toContain('No such file');
  });
});
