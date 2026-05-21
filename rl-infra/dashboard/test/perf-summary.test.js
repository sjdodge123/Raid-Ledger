// ROK-1331 M11 — /api/fleet-health perf_summary field tests (AC4).
//
// The dashboard's /api/fleet-health endpoint is extended with a perf_summary
// field that tails /state/perf.log, groups events, and reports the shape
// documented in §5 of the M11 spec:
//
//   perf_summary: {
//     window_minutes,
//     last_validate_ci: { branch, duration_ms, exit_code, slot } | null,
//     p50_validate_step_ms: { Build, TypeScript, ... },
//     claims_held_minutes: [{ slot, agent_id, held_for_ms }],
//     pkill_survivors_last_release: number,
//     gc_sweep_last_cycle_ms: number | null,
//   }
//
// Tests boot server.js against a tmp STATE_DIR with a hand-crafted perf.log
// and assert the shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
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

const secondsAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

const writePerfLines = async (dir, lines) => {
  await writeFile(join(dir, 'perf.log'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
};

let ctx;
test.before(async () => { ctx = { dir: null, srv: null }; });
test.after(async () => {
  if (ctx?.srv) await ctx.srv.kill();
  if (ctx?.dir) await rm(ctx.dir, { recursive: true, force: true });
});

const boot = async (perfLines = [], claims = []) => {
  if (ctx.srv) await ctx.srv.kill();
  if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true });
  ctx.dir = await mkdtemp(join(tmpdir(), 'rl-dash-m11-'));
  await writeFile(join(ctx.dir, 'claims.json'), JSON.stringify(claims));
  await writeFile(join(ctx.dir, 'env-registry.json'), JSON.stringify([]));
  await mkdir(join(ctx.dir, 'lease-queue'), { recursive: true });
  if (perfLines.length) await writePerfLines(ctx.dir, perfLines);
  ctx.srv = await startServer(ctx.dir);
  return ctx;
};

// AC-M11-ps-1: perf_summary key present on /api/fleet-health
test('AC-M11-ps-1: /api/fleet-health includes perf_summary key', async () => {
  await boot([], []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Object.prototype.hasOwnProperty.call(body, 'perf_summary'),
    'perf_summary key must be on /api/fleet-health');
  assert.equal(typeof body.perf_summary, 'object');
  assert.equal(typeof body.perf_summary.window_minutes, 'number');
  assert.ok(Array.isArray(body.perf_summary.claims_held_minutes));
  // last_validate_ci can be null when no validate.end seen.
  assert.ok('last_validate_ci' in body.perf_summary);
  assert.equal(typeof body.perf_summary.p50_validate_step_ms, 'object');
});

// AC-M11-ps-2: with no perf.log, perf_summary returns safe defaults — never 500
test('AC-M11-ps-2: missing perf.log returns safe defaults', async () => {
  await boot([], []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.perf_summary.last_validate_ci, null);
  assert.deepEqual(body.perf_summary.claims_held_minutes, []);
  assert.equal(body.perf_summary.pkill_survivors_last_release, 0);
});

// AC-M11-ps-3: last_validate_ci surfaces the most recent validate.end event.
test('AC-M11-ps-3: last_validate_ci surfaces the most recent validate.end', async () => {
  const perfLines = [
    { ts: secondsAgo(600), event: 'validate.end', source: 'runner',
      branch: 'rok-old', slot: 2, duration_ms: 500_000, exit_code: 0 },
    { ts: secondsAgo(120), event: 'validate.end', source: 'runner',
      branch: 'rok-1331', slot: 1, duration_ms: 412_000, exit_code: 0 },
    { ts: secondsAgo(60), event: 'validate.step.end', source: 'runner',
      slot: 1, step: 'Build (all workspaces)', duration_ms: 23_000, exit_code: 0 },
  ];
  await boot(perfLines, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const last = body.perf_summary.last_validate_ci;
  assert.ok(last, 'last_validate_ci should not be null when validate.end events exist');
  assert.equal(last.branch, 'rok-1331');
  assert.equal(last.duration_ms, 412_000);
  assert.equal(last.exit_code, 0);
  assert.equal(last.slot, 1);
});

// AC-M11-ps-4: p50_validate_step_ms keyed by step name.
test('AC-M11-ps-4: p50_validate_step_ms keys by step name', async () => {
  // Three Build events: 20s, 23s, 26s; median = 23s.
  const perfLines = [
    { ts: secondsAgo(300), event: 'validate.step.end', source: 'runner', slot: 1,
      step: 'Build (all workspaces)', duration_ms: 20_000, exit_code: 0 },
    { ts: secondsAgo(200), event: 'validate.step.end', source: 'runner', slot: 1,
      step: 'Build (all workspaces)', duration_ms: 26_000, exit_code: 0 },
    { ts: secondsAgo(100), event: 'validate.step.end', source: 'runner', slot: 1,
      step: 'Build (all workspaces)', duration_ms: 23_000, exit_code: 0 },
    { ts: secondsAgo(60), event: 'validate.step.end', source: 'runner', slot: 1,
      step: 'TypeScript (all)', duration_ms: 14_000, exit_code: 0 },
  ];
  await boot(perfLines, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const p50 = body.perf_summary.p50_validate_step_ms;
  assert.equal(p50['Build (all workspaces)'], 23_000, 'median build step ms');
  assert.equal(p50['TypeScript (all)'], 14_000, 'single-sample step ms');
});

// AC-M11-ps-5: pkill_survivors_last_release reflects most recent
// release.pkill_audit event.
test('AC-M11-ps-5: pkill_survivors_last_release reflects last release.pkill_audit', async () => {
  const perfLines = [
    { ts: secondsAgo(600), event: 'release.pkill_audit', source: 'orchestrator',
      slot: 1, surviving_count: 0 },
    { ts: secondsAgo(60), event: 'release.pkill_audit', source: 'orchestrator',
      slot: 2, surviving_count: 3 },
  ];
  await boot(perfLines, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  assert.equal(body.perf_summary.pkill_survivors_last_release, 3);
});

// AC-M11-ps-6: claims_held_minutes derived from currently-claimed slots.
test('AC-M11-ps-6: claims_held_minutes derived from active claims', async () => {
  const startedAt = new Date(Date.now() - 10 * 60_000).toISOString(); // 10min ago
  const claims = [
    { slot: 1, claimed: true, agent_id: 'agent-x', branch: 'rok-1', started_at: startedAt, last_heartbeat: new Date().toISOString() },
    { slot: 2, claimed: false, agent_id: null, branch: null, started_at: null, last_heartbeat: null },
  ];
  await boot([], claims);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  const claimsHeld = body.perf_summary.claims_held_minutes;
  assert.equal(claimsHeld.length, 1);
  assert.equal(claimsHeld[0].slot, 1);
  assert.equal(claimsHeld[0].agent_id, 'agent-x');
  // ~600000 ms (~10 min); allow generous slop for test wallclock skew.
  assert.ok(claimsHeld[0].held_for_ms >= 9 * 60_000 && claimsHeld[0].held_for_ms <= 12 * 60_000,
    `held_for_ms should be ~600000, got ${claimsHeld[0].held_for_ms}`);
});

// AC-M11-ps-7: gc_sweep_last_cycle_ms surfaces the most recent
// gc.sweep.cycle duration.
test('AC-M11-ps-7: gc_sweep_last_cycle_ms reflects last gc.sweep.cycle', async () => {
  const perfLines = [
    { ts: secondsAgo(120), event: 'gc.sweep.cycle', source: 'orchestrator',
      duration_ms: 412 },
    { ts: secondsAgo(60), event: 'gc.sweep.cycle', source: 'orchestrator',
      duration_ms: 280 },
  ];
  await boot(perfLines, []);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  const body = await res.json();
  assert.equal(body.perf_summary.gc_sweep_last_cycle_ms, 280);
});

// AC-M11-ps-8: a malformed perf.log line never 500s the endpoint.
test('AC-M11-ps-8: malformed lines are skipped, never 500', async () => {
  // Manually craft a perf.log with a non-JSON line in the middle.
  ctx.dir = await mkdtemp(join(tmpdir(), 'rl-dash-m11-'));
  await writeFile(join(ctx.dir, 'claims.json'), JSON.stringify([]));
  await writeFile(join(ctx.dir, 'env-registry.json'), JSON.stringify([]));
  await mkdir(join(ctx.dir, 'lease-queue'), { recursive: true });
  const lines = [
    JSON.stringify({ ts: secondsAgo(60), event: 'validate.end', source: 'runner',
      branch: 'rok-x', slot: 1, duration_ms: 100_000, exit_code: 0 }),
    'this is not json',
    JSON.stringify({ ts: secondsAgo(30), event: 'gc.sweep.cycle', source: 'orchestrator', duration_ms: 200 }),
  ];
  await writeFile(join(ctx.dir, 'perf.log'), lines.join('\n') + '\n');
  if (ctx.srv) await ctx.srv.kill();
  ctx.srv = await startServer(ctx.dir);
  const res = await fetch(`${ctx.srv.base}/api/fleet-health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // The well-formed entries should still surface.
  assert.equal(body.perf_summary.gc_sweep_last_cycle_ms, 200);
  assert.equal(body.perf_summary.last_validate_ci.branch, 'rok-x');
});
