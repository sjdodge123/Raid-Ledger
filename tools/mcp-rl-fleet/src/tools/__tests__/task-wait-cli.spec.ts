// ROK-1567 — `rl-task-wait`, the bash-reachable wait.
//
// The point is that an agent can background ONE Bash call and be re-invoked
// when it finishes, instead of paying ~1.5k tokens for each of 50 MCP polls.
// So the contract under test is the STDOUT contract: one line per current_step
// change, one terminal verdict line, and an exit code bash can branch on.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const executeStatus = vi.fn();
vi.mock('../task.js', () => ({
  executeStatus: (...a: unknown[]) => executeStatus(...a),
}));

import { runTaskWait } from '../task-wait-cli.js';

function status(over: Record<string, unknown>): Record<string, unknown> {
  return {
    ok: true,
    task_id: 'abc12345',
    tool: 'rl_validate_ci',
    slot: 2,
    mcp_runtime_status: 'running',
    steps: [],
    ...over,
  };
}

let lines: string[];
const deps = {
  log: (l: string) => lines.push(l),
  sleep: async () => {},
  now: () => new Date('2026-09-14T10:05:00Z'),
};

beforeEach(() => {
  executeStatus.mockReset();
  lines = [];
});

describe('runTaskWait', () => {
  it('prints one line per current_step change, then PASS, and exits 0', async () => {
    executeStatus
      .mockResolvedValueOnce(status({ current_step: 'Build' }))
      .mockResolvedValueOnce(status({ current_step: 'Build' }))
      .mockResolvedValueOnce(status({ current_step: 'Lint' }))
      .mockResolvedValueOnce(
        status({
          mcp_runtime_status: 'succeeded',
          current_step: 'Lint',
          steps: [
            { name: 'Build', status: 'PASS', duration_s: 10 },
            { name: 'Lint', status: 'PASS', duration_s: 5 },
          ],
          playwright_sentinel: '/tmp/.playwright-verified-abc1234',
        }),
      );

    const code = await runTaskWait(['abc12345'], deps);

    expect(
      lines.filter((l) => l.startsWith('[')),
      `expected exactly 2 progress lines (Build, Lint) — a repeated current_step must NOT reprint; got ${JSON.stringify(lines)}`,
    ).toEqual(['[10:05Z] abc12345 running Build', '[10:05Z] abc12345 running Lint']);
    expect(lines[lines.length - 1]).toBe(
      'PASS abc12345 — Build:PASS,Lint:PASS — sentinel=/tmp/.playwright-verified-abc1234',
    );
    expect(code, 'PASS must exit 0 so bash can branch on it').toBe(0);
  });

  it('exits 1 and prints FAIL with the failing step table', async () => {
    executeStatus.mockResolvedValueOnce(
      status({
        mcp_runtime_status: 'failed',
        steps: [
          { name: 'Build', status: 'PASS', duration_s: 10 },
          { name: 'Unit', status: 'FAIL', duration_s: 42 },
        ],
      }),
    );

    const code = await runTaskWait(['abc12345'], deps);

    expect(lines[lines.length - 1]).toBe('FAIL abc12345 — Build:PASS,Unit:FAIL — sentinel=none');
    expect(code, 'a failed task must exit non-zero — expected 1').toBe(1);
  });

  it('reports a cancelled task as CANCELLED, exit 1', async () => {
    executeStatus.mockResolvedValueOnce(status({ mcp_runtime_status: 'cancelled' }));
    const code = await runTaskWait(['abc12345'], deps);
    expect(lines[lines.length - 1]).toBe('CANCELLED abc12345 —  — sentinel=none');
    expect(code).toBe(1);
  });

  it('exits 2 on timeout without claiming a verdict', async () => {
    executeStatus.mockResolvedValue(status({ current_step: 'Playwright' }));
    const code = await runTaskWait(['abc12345', '--timeout', '60', '--interval', '30'], deps);

    expect(code, 'a timeout is not a FAIL — expected exit 2').toBe(2);
    const last = lines[lines.length - 1];
    expect(last.startsWith('TIMEOUT abc12345'), `expected a TIMEOUT line, got ${last}`).toBe(true);
    expect(
      lines.some((l) => l.startsWith('PASS') || l.startsWith('FAIL')),
      'a timeout must never print a verdict',
    ).toBe(false);
  });

  it('always polls in brief mode — the whole point is cheap reads', async () => {
    executeStatus.mockResolvedValueOnce(status({ mcp_runtime_status: 'succeeded' }));
    await runTaskWait(['abc12345'], deps);
    expect(executeStatus).toHaveBeenCalledWith({ task_id: 'abc12345', brief: true });
  });

  it('works for laptop `local-` ids through the same path', async () => {
    executeStatus.mockResolvedValueOnce(
      status({ task_id: 'local-3f9a2c1b8d04', mcp_runtime_status: 'succeeded' }),
    );
    const code = await runTaskWait(['local-3f9a2c1b8d04'], deps);
    expect(executeStatus).toHaveBeenCalledWith({ task_id: 'local-3f9a2c1b8d04', brief: true });
    expect(code).toBe(0);
  });

  it('rejects a missing/invalid task id with exit 2 and a usage line', async () => {
    const code = await runTaskWait([], deps);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('usage: rl-task-wait');
    expect(executeStatus).not.toHaveBeenCalled();
  });

  it('sleeps the requested --interval between polls', async () => {
    const slept: number[] = [];
    executeStatus
      .mockResolvedValueOnce(status({}))
      .mockResolvedValueOnce(status({ mcp_runtime_status: 'succeeded' }));
    await runTaskWait(['abc12345', '--interval', '15'], {
      ...deps,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });
    expect(slept, 'expected a single 15s sleep between the two polls').toEqual([15_000]);
  });
});

describe('runTaskWait — read errors are not verdicts (review MAJOR 1)', () => {
  const errEnvelope = { ok: false, error: 'ssh_unreachable', task_id: 'abc12345', steps: [] };

  it('keeps polling through a transient read error and still reports the real verdict', async () => {
    executeStatus
      .mockResolvedValueOnce(errEnvelope)
      .mockResolvedValueOnce(errEnvelope)
      .mockResolvedValueOnce(status({ mcp_runtime_status: 'succeeded' }));

    const code = await runTaskWait(['abc12345'], deps);

    expect(
      lines.some((l) => l.startsWith('FAIL')),
      `a network hiccup must never be reported as a task FAIL — got ${JSON.stringify(lines)}`,
    ).toBe(false);
    expect(lines[lines.length - 1]).toBe('PASS abc12345 —  — sentinel=none');
    expect(code).toBe(0);
  });

  it('gives up after 5 consecutive read errors with READ-ERROR and exit 2', async () => {
    executeStatus.mockResolvedValue(errEnvelope);
    const code = await runTaskWait(['abc12345'], deps);
    expect(lines[lines.length - 1]).toBe('READ-ERROR abc12345 — ssh_unreachable');
    expect(code, 'an unreadable task is not a FAIL — expected exit 2').toBe(2);
    expect(executeStatus).toHaveBeenCalledTimes(5);
  });
});

describe('runTaskWait — arg parsing + step rendering (review MINOR/NIT)', () => {
  it('accepts flags BEFORE the task id', async () => {
    executeStatus.mockResolvedValueOnce(status({ mcp_runtime_status: 'succeeded' }));
    const code = await runTaskWait(['--timeout', '60', 'abc12345'], deps);
    expect(
      executeStatus,
      "'--timeout 60 abc12345' must not parse 60 as the task id",
    ).toHaveBeenCalledWith({ task_id: 'abc12345', brief: true });
    expect(code).toBe(0);
  });

  it('never renders undefined:undefined for a malformed step', async () => {
    executeStatus.mockResolvedValueOnce(
      status({
        mcp_runtime_status: 'failed',
        steps: [{ name: 'Build', status: 'PASS', duration_s: 1 }, {}, null],
      }),
    );
    await runTaskWait(['abc12345'], deps);
    expect(lines[lines.length - 1]).toBe('FAIL abc12345 — Build:PASS — sentinel=none');
  });
});

describe('runTaskWait — option validation + short timeouts (Codex P2)', () => {
  it('rejects a non-numeric option value instead of silently defaulting', async () => {
    const code = await runTaskWait(['abc12345', '--timeout', 'nope'], deps);
    expect(code, 'a typo must not become a silent 3600s wait — expected exit 2').toBe(2);
    expect(lines.join('\n')).toContain('--timeout');
    expect(executeStatus, 'a usage error must not start polling').not.toHaveBeenCalled();
  });

  it('rejects a flag with no value at all', async () => {
    const code = await runTaskWait(['abc12345', '--interval'], deps);
    expect(code).toBe(2);
    expect(lines.join('\n')).toContain('--interval');
    expect(executeStatus).not.toHaveBeenCalled();
  });

  it('rejects a zero/negative option value', async () => {
    const code = await runTaskWait(['abc12345', '--interval', '0'], deps);
    expect(code).toBe(2);
    expect(executeStatus).not.toHaveBeenCalled();
  });

  it('still observes a task that finishes inside a timeout SHORTER than the interval', async () => {
    const slept: number[] = [];
    executeStatus
      .mockResolvedValueOnce(status({ current_step: 'Build' }))
      .mockResolvedValueOnce(status({ mcp_runtime_status: 'succeeded' }));

    const code = await runTaskWait(['abc12345', '--timeout', '10', '--interval', '30'], {
      ...deps,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    });

    expect(
      slept,
      'the nap must be clamped to the REMAINING budget (10s), not the 30s interval',
    ).toEqual([10_000]);
    expect(
      code,
      'a task that finished within the timeout must report PASS, not TIMEOUT-after-0s',
    ).toBe(0);
    expect(lines[lines.length - 1]).toBe('PASS abc12345 —  — sentinel=none');
  });

  it('reports the real elapsed budget when a short timeout does expire', async () => {
    executeStatus.mockResolvedValue(status({ current_step: 'Build' }));
    const code = await runTaskWait(['abc12345', '--timeout', '10', '--interval', '30'], deps);
    expect(code).toBe(2);
    expect(
      lines[lines.length - 1],
      'expected TIMEOUT after the full 10s budget, not after 0s',
    ).toContain('after 10s');
    expect(executeStatus, 'it must poll at least twice inside the budget').toHaveBeenCalledTimes(2);
  });
});
