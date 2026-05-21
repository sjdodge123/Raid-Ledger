// ROK-1331 M5b — dashboard `/api/state` must surface:
//   - lease_queues: [{slot, current_holder: {agent_id, branch, expires_at} | null, queue: [...]}]
//   - expires_at on each slot's current_holder (ride-along from M5a's claims.json)
//   - env.pinned boolean (ride-along from M5a's env-registry.json)
//
// AND the dashboard projection of `active_tasks` must NOT include the four
// task-status extension fields (last_output_at, last_line, current_step,
// progress_hint). Those land on the MCP rl_task_status path ONLY.
//
// Strategy: spawn server.js as a child process with STATE_DIR pointed at a
// temp dir we control; fetch /api/state; assert shape. node:test only — no
// Vitest in this directory (dashboard is intentionally zero-dep).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_DIR = join(import.meta.dirname, '..', '..', '..');
const SERVER_PATH = join(REPO_DIR, 'rl-infra/dashboard/server.js');

const FIXED_PORT = 18765; // unlikely to collide with anything else on a dev box

let serverProc = null;
let stateDir = null;

async function startServer({ claims, envs, leaseQueues = {}, tasks = [] }) {
  stateDir = await mkdtemp(join(tmpdir(), 'rl-dash-test-'));
  await mkdir(join(stateDir, 'lease-queue'), { recursive: true });
  await mkdir(join(stateDir, 'tasks'), { recursive: true });
  await mkdir(join(stateDir, 'test-plans'), { recursive: true });
  await writeFile(join(stateDir, 'claims.json'), JSON.stringify(claims));
  await writeFile(join(stateDir, 'env-registry.json'), JSON.stringify(envs));
  for (const [slot, q] of Object.entries(leaseQueues)) {
    await writeFile(join(stateDir, 'lease-queue', `${slot}.json`), JSON.stringify(q));
  }
  for (const task of tasks) {
    await writeFile(join(stateDir, 'tasks', `${task.task_id}.json`), JSON.stringify(task));
  }
  serverProc = spawn('node', [SERVER_PATH], {
    env: {
      ...process.env,
      STATE_DIR: stateDir,
      PORT: String(FIXED_PORT),
      PUBLIC_DIR: join(REPO_DIR, 'rl-infra/dashboard/public'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Wait for the "listening" log line OR a 3s budget.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server boot timeout')), 3000);
    serverProc.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
    serverProc.on('exit', (code) => {
      clearTimeout(t);
      reject(new Error(`server exited early code=${code}`));
    });
  });
}

async function stopServer() {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => serverProc.once('exit', r));
    serverProc = null;
  }
  if (stateDir) {
    await rm(stateDir, { recursive: true, force: true });
    stateDir = null;
  }
}

async function fetchState() {
  const res = await fetch(`http://127.0.0.1:${FIXED_PORT}/api/state`);
  return { status: res.status, body: await res.json() };
}

describe('dashboard /api/state — M5b lease_queues + expires_at + pinned', () => {
  before(async () => {
    await startServer({
      claims: [
        {
          slot: 1,
          claimed: true,
          agent_id: 'agent-a',
          branch: 'rok-1331-foo',
          started_at: '2026-05-20T12:00:00.000Z',
          last_heartbeat: '2026-05-20T12:05:00.000Z',
          expires_at: '2026-05-20T13:00:00.000Z',
        },
        { slot: 2, claimed: false, agent_id: null, branch: null, started_at: null, last_heartbeat: null },
      ],
      envs: [
        { slug: 'rok-1297', slot: 1, ttl: '24h', last_touched: '2026-05-20T12:01:00.000Z', pinned: true },
        { slug: 'rok-1331-foo', slot: 1, ttl: '24h', last_touched: '2026-05-20T12:02:00.000Z' },
      ],
      leaseQueues: {
        1: {
          slot: 1,
          current_holder: { agent_id: 'agent-a', branch: 'rok-1331-foo', expires_at: '2026-05-20T13:00:00.000Z' },
          queue: [
            { agent_id: 'agent-b', branch: 'rok-1331-bar', requested_at: '2026-05-20T12:10:00.000Z' },
          ],
        },
        2: { slot: 2, current_holder: null, queue: [] },
      },
      tasks: [
        {
          task_id: 'task-1',
          tool: 'rl_validate_ci',
          slot: 1,
          args_summary: '--full',
          status: 'running',
          started_at: '2026-05-20T12:03:00.000Z',
          elapsed_seconds: 120,
          finished_at: null,
          // Fields that MUST be stripped from dashboard projection:
          last_output_at: '2026-05-20T12:04:58.000Z',
          last_line: '[heartbeat] elapsed=120s pid=4711 cpu=12.3% rss=512MB current_test=signups',
          current_step: 'Integration tests (api)',
          progress_hint: 'jest: suite 12 of 18',
        },
      ],
    });
  });

  after(async () => {
    await stopServer();
  });

  it('returns 200 with lease_queues array in /api/state', async () => {
    const { status, body } = await fetchState();
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.lease_queues), `lease_queues must be an array; got ${typeof body.lease_queues}`);
    assert.equal(body.lease_queues.length, 2, 'lease_queues must contain entries for slots 1..N');
  });

  it('lease_queues[slot=1] surfaces queue length 1 (agent-b enqueued)', async () => {
    const { body } = await fetchState();
    const slot1 = body.lease_queues.find((q) => q.slot === 1);
    assert.ok(slot1, 'slot 1 entry missing from lease_queues');
    assert.equal(slot1.queue.length, 1);
    assert.equal(slot1.queue[0].agent_id, 'agent-b');
    assert.equal(slot1.queue[0].branch, 'rok-1331-bar');
  });

  it('lease_queues[slot=1].current_holder includes expires_at for TTL countdown', async () => {
    const { body } = await fetchState();
    const slot1 = body.lease_queues.find((q) => q.slot === 1);
    assert.ok(slot1.current_holder, 'slot 1 must have current_holder');
    assert.equal(slot1.current_holder.expires_at, '2026-05-20T13:00:00.000Z');
    assert.equal(slot1.current_holder.agent_id, 'agent-a');
  });

  it('slots[slot=1].expires_at rides through enrichSlotsWithProbes', async () => {
    const { body } = await fetchState();
    const slot1 = body.slots.find((s) => s.slot === 1);
    assert.equal(slot1.expires_at, '2026-05-20T13:00:00.000Z',
      'enrichSlotsWithProbes must NOT strip expires_at from claimed slot');
  });

  it('envs[slug=rok-1297] carries pinned: true (ride-along from env-registry)', async () => {
    const { body } = await fetchState();
    const pinnedEnv = body.envs.find((e) => e.slug === 'rok-1297');
    assert.ok(pinnedEnv, 'pinned env rok-1297 missing from /api/state envs');
    assert.equal(pinnedEnv.pinned, true);
  });

  it('envs without pinned field do NOT have pinned===true', async () => {
    const { body } = await fetchState();
    const unpinnedEnv = body.envs.find((e) => e.slug === 'rok-1331-foo');
    assert.notEqual(unpinnedEnv.pinned, true);
  });

  it('payload preserves existing top-level fields (no regression)', async () => {
    const { body } = await fetchState();
    for (const field of ['ok', 'slots', 'envs', 'public_domain', 'generated_at']) {
      assert.ok(field in body, `existing field ${field} missing from /api/state`);
    }
    assert.equal(body.ok, true);
  });

  it('active_tasks projection does NOT include last_output_at/last_line/current_step/progress_hint', async () => {
    const { body } = await fetchState();
    assert.ok(Array.isArray(body.active_tasks), 'active_tasks must be an array');
    if (body.active_tasks.length === 0) {
      // Acceptable IF M3 isn't fully wired yet — but spec says projection must exist.
      assert.fail('active_tasks empty — M3 projection appears unwired or test task fixture missed');
    }
    const t1 = body.active_tasks.find((t) => t.task_id === 'task-1');
    assert.ok(t1, 'task-1 missing from active_tasks projection');
    // The four M5b task-status extensions MUST NOT appear in the dashboard projection.
    for (const f of ['last_output_at', 'last_line', 'current_step', 'progress_hint']) {
      assert.equal(
        f in t1, false,
        `dashboard active_tasks projection MUST NOT include ${f} (MCP rl_task_status path only)`,
      );
    }
  });

  it('lease_queues empty entry rendered when slot has no claim file', async () => {
    const { body } = await fetchState();
    const slot2 = body.lease_queues.find((q) => q.slot === 2);
    assert.ok(slot2, 'slot 2 lease_queues entry must exist even when no claim');
    assert.equal(slot2.current_holder, null);
    assert.deepEqual(slot2.queue, []);
  });
});

describe('dashboard /api/state — degraded states', () => {
  before(async () => {
    await startServer({
      claims: [{ slot: 1, claimed: false }, { slot: 2, claimed: false }],
      envs: [],
      leaseQueues: {}, // no lease-queue files at all
      tasks: [],
    });
  });

  after(async () => {
    await stopServer();
  });

  it('lease_queues array still present (empty per slot) when no queue files exist', async () => {
    const { body } = await fetchState();
    assert.ok(Array.isArray(body.lease_queues), 'lease_queues must always be an array, even if no files');
    for (const q of body.lease_queues) {
      assert.equal(q.queue.length, 0, 'missing lease-queue file should yield empty queue, not error');
    }
  });
});
