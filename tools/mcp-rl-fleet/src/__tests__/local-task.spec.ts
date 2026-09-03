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

/** A finished rl_env_deploy task — the only task shape that carries a credential. */
function deployedTask(): LocalTaskJson {
  return baseTask({
    mcp_runtime_status: 'succeeded',
    finished_at: '2026-06-07T00:05:00.000Z',
    current_step: null,
    url: 'https://slot-1.gamernight.net',
    slot_url: 'https://slot-1.gamernight.net',
    admin_email: 'admin@local',
    admin_password: 'hunter2',
    expected_head: 'abc1234',
    synced_head: 'abc1234',
  });
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

  it('surfaces rl_env_deploy result fields (url + admin login) on a terminal read (Codex P1)', () => {
    const t = deployedTask();
    writeLocalTask(t);
    const r = readLocalTask(t.task_id) as {
      url?: string;
      admin_email?: string;
      synced_head?: string;
    };
    expect(r.url).toBe('https://slot-1.gamernight.net');
    expect(r.admin_email).toBe('admin@local');
    expect(r.synced_head).toBe('abc1234');
  });

  // A3-B P4 — the credential must not ride along on a routine deploy poll.
  it('WITHHOLDS admin_password from a default terminal read, marking it available', () => {
    const t = deployedTask();
    writeLocalTask(t);
    const r = readLocalTask(t.task_id) as {
      admin_password?: string;
      admin_password_available?: boolean;
    };
    expect(
      r.admin_password,
      `polling a deploy task must not hand back the env password — expected undefined, got ${JSON.stringify(r.admin_password)}`,
    ).toBeUndefined();
    expect(
      JSON.stringify(r).includes('hunter2'),
      `the secret must appear nowhere in a default rl_task_status payload — expected false, got true for ${JSON.stringify(r)}`,
    ).toBe(false);
    expect(
      r.admin_password_available,
      `the caller must still learn a password EXISTS — expected true, got ${JSON.stringify(r.admin_password_available)}`,
    ).toBe(true);
  });

  // A3-B verifier finding — the INTEGRATED path, not a hand-built literal.
  // toStatusReturn materialises `admin_password: raw.admin_password` on every
  // task, so the key exists (as undefined) even where no credential ever did.
  // `admin_password_available: false` is documented (env-spin.ts, credentials.ts)
  // as "bootstrap-admin FAILED — read bootstrap_warnings", so stamping it here
  // reports a bootstrap failure that never happened.
  it('does NOT claim a bootstrap failure on a clone task that never had a password', () => {
    const t = baseTask({
      tool: 'rl_env_clone_prod',
      mcp_runtime_status: 'succeeded',
      finished_at: '2026-06-07T00:05:00.000Z',
      current_step: null,
    });
    writeLocalTask(t);
    const r = readLocalTask(t.task_id) as { admin_password_available?: boolean };
    expect(
      Object.prototype.hasOwnProperty.call(r, 'admin_password_available'),
      `rl_env_clone_prod never bootstraps an admin, so the presence marker must be ABSENT — ` +
        `available:false is the documented bootstrap-FAILED signal. expected hasOwnProperty false, ` +
        `got true (value ${JSON.stringify(r.admin_password_available)})`,
    ).toBe(false);
  });

  it('does NOT claim a bootstrap failure on a mid-flight deploy poll', () => {
    const t = baseTask(); // running rl_env_deploy — env-spin has not run yet
    writeLocalTask(t);
    const r = readLocalTask(t.task_id) as { admin_password_available?: boolean };
    expect(
      r.admin_password_available,
      `a still-running deploy has not reached bootstrap-admin yet; available:false tells the ` +
        `poller it FAILED — expected undefined, got ${JSON.stringify(r.admin_password_available)}`,
    ).toBeUndefined();
  });

  it('returns admin_password only when the caller passes include_credentials', () => {
    const t = deployedTask();
    writeLocalTask(t);
    const r = readLocalTask(t.task_id, undefined, true) as { admin_password?: string };
    expect(
      r.admin_password,
      `include_credentials must still work as the opt-in route — expected "hunter2", got ${JSON.stringify(r.admin_password)}`,
    ).toBe('hunter2');
  });

  it('still stores the password on disk so the opt-in read has something to return', () => {
    const t = deployedTask();
    writeLocalTask(t);
    expect(
      readRawLocalTask(t.task_id)?.admin_password,
      'the 0600 task JSON is the recovery path — redaction is a READ-boundary concern, not a storage one',
    ).toBe('hunter2');
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
