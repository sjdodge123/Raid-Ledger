// ROK-1362 — laptop task registry. Real fs round-trips under a temp HOME so
// tasksDir() = $HOME/.raid-ledger/tasks resolves into a throwaway dir. spawn is
// mocked so spawnLocalRunner doesn't launch a real `npx tsx` child.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSpawn = vi.fn((..._a: unknown[]) => ({ pid: 55_555, unref: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: (...a: unknown[]) => mockSpawn(...a) }));

import {
  isLocalTaskId,
  newLocalTaskId,
  writeLocalTask,
  readLocalTask,
  readRawLocalTask,
  cancelLocalTask,
  waitLocalTask,
  localLogPath,
  localLogTail,
  spawnLocalRunner,
  isPidAlive,
  type LocalTaskJson,
} from '../local-task.js';

let homeDir: string;
let prevHome: string | undefined;

function baseTask(over: Partial<LocalTaskJson> = {}): LocalTaskJson {
  const id = over.task_id ?? newLocalTaskId();
  return {
    task_id: id,
    tool: 'rl_env_deploy',
    slot: null,
    args_summary: 'rok-test',
    started_at: '2026-06-07T00:00:00.000Z',
    finished_at: null,
    mcp_runtime_status: 'running',
    script_exit_code: null,
    steps: [],
    current_step: 'building',
    log_path: localLogPath(id),
    pid: process.pid, // alive by default
    failed_step: null,
    ...over,
  };
}

beforeEach(() => {
  prevHome = process.env.HOME;
  homeDir = mkdtempSync(join(tmpdir(), 'rl-localtask-'));
  process.env.HOME = homeDir;
  mockSpawn.mockClear();
});
afterEach(() => {
  process.env.HOME = prevHome;
  rmSync(homeDir, { recursive: true, force: true });
});

describe('isLocalTaskId', () => {
  it('matches local- ids and rejects VM ids', () => {
    expect(isLocalTaskId('local-3f9a2c1b8d04')).toBe(true);
    expect(isLocalTaskId(newLocalTaskId())).toBe(true);
    expect(isLocalTaskId('abc123def456')).toBe(false);
    expect(isLocalTaskId('LOCAL-3f9a2c1b8d04')).toBe(false);
  });
});

describe('write → read round-trip', () => {
  it('writes atomically (no leftover .tmp) and reads back mapped status', () => {
    const t = baseTask();
    writeLocalTask(t);
    const files = readdirSync(join(homeDir, '.raid-ledger', 'tasks'));
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
    const r = readLocalTask(t.task_id);
    expect(r.ok).toBe(true);
    expect(r.task_id).toBe(t.task_id);
    expect(r.tool).toBe('rl_env_deploy');
    expect(r.mcp_runtime_status).toBe('running');
    expect(typeof r.elapsed_seconds).toBe('number');
  });

  it('returns task_not_found for a missing id', () => {
    const r = readLocalTask('local-deadbeefdead');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('task_not_found');
  });
});

describe('PID-liveness synthesis', () => {
  it('isPidAlive is true for our own pid, false for an unused high pid', () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2_147_480_000)).toBe(false);
  });

  it('synthesizes process_died when a running task pid is dead', () => {
    const t = baseTask({ pid: 2_147_480_000 });
    writeLocalTask(t);
    const r = readLocalTask(t.task_id);
    expect(r.ok).toBe(false);
    expect(r.mcp_runtime_status).toBe('failed');
    expect(r.error).toBe('process_died');
    expect(r.message).toMatch(/slept\/rebooted|killed mid-chain/);
    // Deterministic on repeat (reader does not rewrite the file).
    expect(readLocalTask(t.task_id).error).toBe('process_died');
  });

  it('does NOT synthesize for a terminal task with a dead pid', () => {
    const t = baseTask({ pid: 2_147_480_000, mcp_runtime_status: 'succeeded', finished_at: '2026-06-07T00:05:00.000Z' });
    writeLocalTask(t);
    const r = readLocalTask(t.task_id);
    expect(r.ok).toBe(true);
    expect(r.mcp_runtime_status).toBe('succeeded');
  });
});

describe('localLogTail', () => {
  it('returns the last N bytes of the log', () => {
    const t = baseTask();
    writeLocalTask(t);
    writeFileSync(localLogPath(t.task_id), 'A'.repeat(100) + 'TAIL');
    expect(localLogTail(t.task_id, 4)).toBe('TAIL');
    expect(localLogTail(t.task_id, 0)).toBe('');
  });
});

describe('cancelLocalTask', () => {
  it('writes a terminal cancelled state (dead pid → no self-kill)', async () => {
    const t = baseTask({ pid: 2_147_480_000 });
    writeLocalTask(t);
    const res = await cancelLocalTask(t.task_id, 'operator-requested');
    expect(res.ok).toBe(true);
    expect(res.cancelled).toBe(true);
    expect(res.mcp_runtime_status).toBe('cancelled');
    const raw = readRawLocalTask(t.task_id);
    expect(raw?.mcp_runtime_status).toBe('cancelled');
    expect(raw?.message).toContain('operator-requested');
  });

  it('is idempotent on an already-terminal task', async () => {
    const t = baseTask({ mcp_runtime_status: 'succeeded', finished_at: '2026-06-07T00:05:00.000Z' });
    writeLocalTask(t);
    const res = await cancelLocalTask(t.task_id, 'cleanup');
    expect(res.ok).toBe(true);
    expect(res.mcp_runtime_status).toBe('succeeded');
  });

  it('returns task_not_found for a missing id', async () => {
    const res = await cancelLocalTask('local-deadbeefdead', 'x');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('task_not_found');
  });
});

describe('waitLocalTask', () => {
  it('returns immediately when the task is already terminal', async () => {
    const t = baseTask({ mcp_runtime_status: 'succeeded', finished_at: '2026-06-07T00:05:00.000Z' });
    writeLocalTask(t);
    const r = await waitLocalTask(t.task_id, 5);
    expect(r.ok).toBe(true);
    expect((r as { mcp_runtime_status?: string }).mcp_runtime_status).toBe('succeeded');
  });

  it('returns a still_running snapshot on cap-expiry for a stuck-running task', async () => {
    const t = baseTask(); // running, alive pid (our own), never changes
    writeLocalTask(t);
    const r = (await waitLocalTask(t.task_id, 5)) as { ok: boolean; status?: string; current_step?: string };
    expect(r.ok).toBe(false);
    expect(r.status).toBe('still_running');
    expect(r.current_step).toBe('building');
  }, 10_000);
});

describe('spawnLocalRunner', () => {
  it('spawns a detached child and writes the initial running JSON with its pid', () => {
    const id = newLocalTaskId();
    const out = spawnLocalRunner(id, 'rl_env_deploy', { slug: 'rok-test' }, 'rok-test');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0] as unknown as [string, string[], { detached?: boolean }];
    expect(cmd).toBe('npx');
    expect(args[0]).toBe('tsx');
    expect(args).toContain(id);
    expect(args).toContain('rl_env_deploy');
    expect(opts.detached).toBe(true);
    expect(out.task_id).toBe(id);
    expect(out.pid).toBe(55_555);
    const raw = readRawLocalTask(id);
    expect(raw?.mcp_runtime_status).toBe('running');
    expect(raw?.pid).toBe(55_555);
    expect(raw?.args_summary).toBe('rok-test');
    expect(existsSync(localLogPath(id))).toBe(true);
  });
});
