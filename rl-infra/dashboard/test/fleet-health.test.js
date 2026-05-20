// ROK-1331 M7 — /api/fleet-health endpoint tests.
//
// Agents have near-zero fleet visibility today (only rl_status + the
// per-runner peek). The fleet-health endpoint tails /state/audit.log,
// classifies recent errors, surfaces stale-heartbeat slots + queue-stuck
// entries, and reports per-runner warnings — all in one cheap read so an
// agent can poll the endpoint after a flake to see if it's a known
// fleet-bug-class or a new failure.
//
// Tests boot server.js against a tmp STATE_DIR with hand-crafted state
// files + audit.log fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

const pickFreePort = () => new Promise((res, rej) => {
  const s = createNetServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

const waitForListening = async (port, deadline = Date.now() + 5000) => {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      if (r.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`server did not become reachable on :${port} within 5s`);
};

const startServer = async (stateDir) => {
  const port = await pickFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      STATE_DIR: stateDir,
      PUBLIC_DIR,
      RL_AGENT_TOKEN: 'test-token-not-used',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  await waitForListening(port);
  return {
    base: `http://127.0.0.1:${port}`,
    kill: () => new Promise((r) => {
      child.once('exit', () => r());
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000).unref();
    }),
  };
};

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

const writeState = async (dir, claims, envs, lease_queues = {}, audit_lines = []) => {
  await writeFile(join(dir, 'claims.json'), JSON.stringify(claims));
  await writeFile(join(dir, 'env-registry.json'), JSON.stringify(envs));
  await mkdir(join(dir, 'lease-queue'), { recursive: true });
  for (const [slot, queue] of Object.entries(lease_queues)) {
    await writeFile(join(dir, 'lease-queue', `${slot}.json`), JSON.stringify(queue));
  }
  if (audit_lines.length) {
    await writeFile(join(dir, 'audit.log'), audit_lines.join('\n') + '\n');
  }
};

let ctx;
test.before(async () => { ctx = { dir: null, srv: null }; });
test.after(async () => {
  if (ctx?.srv) await ctx.srv.kill();
  if (ctx?.dir) await rm(ctx.dir, { recursive: true, force: true });
});

const boot = async (claims = [], envs = [], lease_queues = {}, audit_lines = []) => {
  if (ctx.srv) await ctx.srv.kill();
  if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true });
  ctx.dir = await mkdtemp(join(tmpdir(), 'rl-dash-m7-'));
  await writeState(ctx.dir, claims, envs, lease_queues, audit_lines);
  ctx.srv = await startServer(ctx.dir);
  return ctx;
};

// AC-M7-fh-1: endpoint exists and returns the documented top-level shape.
test('AC-M7-fh-1: GET /api/fleet-health returns shape', async () => {
  await boot([], [], {}, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const key of [
    'generated_at',
    'stale_heartbeat_slots',
    'queue_stuck',
    'runner_warnings',
    'recent_audit_errors',
    'summary',
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(body, key), `top-level key missing: ${key}`);
  }
  assert.equal(typeof body.generated_at, 'string');
  assert.match(body.generated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Array.isArray(body.stale_heartbeat_slots));
  assert.ok(Array.isArray(body.queue_stuck));
  assert.ok(Array.isArray(body.runner_warnings));
  assert.ok(Array.isArray(body.recent_audit_errors));
  assert.equal(typeof body.summary, 'object');
  assert.equal(typeof body.summary.ok, 'boolean');
});

// AC-M7-fh-2: stale-heartbeat detection — slot whose claim's last_heartbeat
// is > 300s old appears in stale_heartbeat_slots.
test('AC-M7-fh-2: stale-heartbeat slots are surfaced', async () => {
  const claims = [
    { slot: 1, claimed: true, agent_id: 'agent-stale', branch: 'rok-x',
      started_at: minutesAgo(120), last_heartbeat: minutesAgo(20) },
    { slot: 2, claimed: true, agent_id: 'agent-fresh', branch: 'rok-y',
      started_at: minutesAgo(120), last_heartbeat: secondsAgo(30) },
  ];
  await boot(claims, [], {}, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const stale = body.stale_heartbeat_slots;
  assert.equal(stale.length, 1, `expected 1 stale slot, got ${stale.length}`);
  assert.equal(stale[0].slot, 1);
  assert.equal(stale[0].agent_id, 'agent-stale');
  assert.equal(stale[0].branch, 'rok-x');
  assert.ok(stale[0].heartbeat_age_seconds >= 1200,
    `heartbeat_age_seconds should be ~1200, got ${stale[0].heartbeat_age_seconds}`);
});

// AC-M7-fh-3: queue-stuck detection — lease-queue entry whose requested_at
// is older than QUEUE_TTL_SECONDS (1800s) appears in queue_stuck.
test('AC-M7-fh-3: queue-stuck entries are surfaced', async () => {
  const claims = [
    { slot: 1, claimed: true, agent_id: 'agent-holder', branch: 'rok-h',
      started_at: minutesAgo(30), last_heartbeat: secondsAgo(15) },
  ];
  const lease_queues = {
    1: [
      // Stuck: requested 45min ago, exceeds 30min default TTL.
      { agent_id: 'agent-waiting', branch: 'rok-w', requested_at: minutesAgo(45),
        preempt: false, last_heartbeat: secondsAgo(60) },
      // Fresh: requested 5min ago, well under TTL.
      { agent_id: 'agent-patient', branch: 'rok-p', requested_at: minutesAgo(5),
        preempt: false, last_heartbeat: secondsAgo(30) },
    ],
  };
  await boot(claims, [], lease_queues, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const stuck = body.queue_stuck;
  assert.ok(stuck.length >= 1, `expected at least 1 stuck queue entry, got ${stuck.length}`);
  const waiting = stuck.find((e) => e.agent_id === 'agent-waiting');
  assert.ok(waiting, 'agent-waiting should be flagged as stuck');
  assert.ok(waiting.queued_for_seconds >= 2700,
    `queued_for_seconds should be ~2700, got ${waiting.queued_for_seconds}`);
  assert.equal(waiting.exceeds_ttl, true);
  // agent-patient is NOT stuck.
  assert.ok(!stuck.find((e) => e.agent_id === 'agent-patient'),
    'agent-patient should not be flagged');
});

// AC-M7-fh-4: audit-log classification — count + last_seen + sample per
// known error category (permission_denied, exit_255, oom, socket_hang_up,
// inotify_missing, dubious_ownership, illegal_instruction).
test('AC-M7-fh-4: audit-log classifier counts known error categories', async () => {
  const audit_lines = [
    JSON.stringify({ ts: secondsAgo(60), cmd: 'env-spin', outcome: 'fail',
      agent: 'a1', error: 'Permission denied while writing /srv/rl-infra/state/lock.json' }),
    JSON.stringify({ ts: secondsAgo(120), cmd: 'env-spin', outcome: 'fail',
      agent: 'a1', error: 'permission denied' }),
    JSON.stringify({ ts: secondsAgo(45), cmd: 'validate-ci', outcome: 'fail',
      agent: 'a2', error: 'ssh exited 255 with no output' }),
    JSON.stringify({ ts: secondsAgo(30), cmd: 'env-build', outcome: 'fail',
      agent: 'a3', error: 'Container killed — out of memory (OOM)' }),
    JSON.stringify({ ts: secondsAgo(20), cmd: 'task-status', outcome: 'fail',
      agent: 'a4', error: 'socket hang up while reading from runner' }),
    JSON.stringify({ ts: secondsAgo(10), cmd: 'task-wait', outcome: 'fail',
      agent: 'a5', error: 'inotifywait not installed in runner image' }),
    JSON.stringify({ ts: secondsAgo(5), cmd: 'env-spin', outcome: 'fail',
      agent: 'a6', error: 'fatal: detected dubious ownership in repository at /workspace' }),
    JSON.stringify({ ts: secondsAgo(2), cmd: 'env-spin', outcome: 'fail',
      agent: 'a7', error: 'Illegal instruction (core dumped) while loading sharp' }),
    // benign entry — should not be classified into any category.
    JSON.stringify({ ts: secondsAgo(1), cmd: 'claim', outcome: 'ok', agent: 'a8' }),
  ];
  await boot([], [], {}, audit_lines);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const cats = Object.fromEntries(
    body.recent_audit_errors.map((c) => [c.category, c]),
  );
  for (const wanted of [
    'permission_denied', 'exit_255', 'oom', 'socket_hang_up',
    'inotify_missing', 'dubious_ownership', 'illegal_instruction',
  ]) {
    assert.ok(cats[wanted], `category missing: ${wanted}`);
  }
  assert.equal(cats.permission_denied.count, 2, 'permission_denied count');
  assert.equal(cats.exit_255.count, 1, 'exit_255 count');
  assert.equal(cats.oom.count, 1, 'oom count');
  assert.equal(cats.socket_hang_up.count, 1, 'socket_hang_up count');
  assert.equal(cats.inotify_missing.count, 1, 'inotify_missing count');
  assert.equal(cats.dubious_ownership.count, 1, 'dubious_ownership count');
  assert.equal(cats.illegal_instruction.count, 1, 'illegal_instruction count');
  // last_seen + sample populated for each non-zero category.
  for (const wanted of [
    'permission_denied', 'exit_255', 'oom', 'socket_hang_up',
    'inotify_missing', 'dubious_ownership', 'illegal_instruction',
  ]) {
    assert.ok(cats[wanted].last_seen, `last_seen missing for ${wanted}`);
    assert.ok(typeof cats[wanted].sample === 'string' && cats[wanted].sample.length > 0,
      `sample missing for ${wanted}`);
  }
});

// AC-M7-fh-5: missing audit.log → empty counts, no 500.
test('AC-M7-fh-5: missing audit.log returns zeroed counts', async () => {
  await boot([], [], {}, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const cat of body.recent_audit_errors) {
    assert.equal(cat.count, 0, `category ${cat.category} should be 0`);
  }
});

// AC-M7-fh-6: missing lease-queue dir + claims.json missing should still
// return 200 with empty arrays. Robustness for partially-bootstrapped state.
test('AC-M7-fh-6: missing state files do not 500 the endpoint', async () => {
  // Manually mkdtemp without writing any state files.
  if (ctx.srv) await ctx.srv.kill();
  if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true });
  ctx.dir = await mkdtemp(join(tmpdir(), 'rl-dash-m7-'));
  ctx.srv = await startServer(ctx.dir);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.stale_heartbeat_slots, []);
  assert.deepEqual(body.queue_stuck, []);
});

// AC-M7-fh-7: summary reflects the aggregated counts.
test('AC-M7-fh-7: summary.warning_count + summary.ok reflect findings', async () => {
  const claims = [
    { slot: 1, claimed: true, agent_id: 'agent-stale', branch: 'rok-x',
      started_at: minutesAgo(60), last_heartbeat: minutesAgo(15) },
  ];
  const audit_lines = [
    JSON.stringify({ ts: secondsAgo(30), cmd: 'env-spin', outcome: 'fail',
      agent: 'a1', error: 'permission denied' }),
  ];
  await boot(claims, [], {}, audit_lines);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  assert.equal(body.summary.stale_slots, 1);
  assert.equal(body.summary.ok, false, 'ok must be false when warnings exist');
  assert.ok(body.summary.warning_count >= 2,
    `warning_count should include stale slot + audit error, got ${body.summary.warning_count}`);
});

// AC-M7-fh-8: method-not-allowed for POST.
test('AC-M7-fh-8: POST /api/fleet-health returns 405', async () => {
  await boot([], [], {}, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`, { method: 'POST' });
  assert.equal(res.status, 405);
});

// AC-M7-fh-9: completely clean fleet → summary.ok=true.
test('AC-M7-fh-9: clean fleet returns summary.ok=true', async () => {
  const claims = [
    { slot: 1, claimed: true, agent_id: 'agent-fresh', branch: 'rok-x',
      started_at: minutesAgo(5), last_heartbeat: secondsAgo(10) },
  ];
  await boot(claims, [], {}, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  assert.equal(body.summary.stale_slots, 0);
  assert.equal(body.summary.stuck_queue_entries, 0);
  assert.equal(body.summary.ok, true);
});
