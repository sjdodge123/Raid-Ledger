// ROK-1331 M3 — failing tests for the server side of the dashboard
// active-task render. Drives `/api/state` projection + `/api/tasks/<id>/log`.
//
// Strategy: spawn server.js as a child process against a tmp STATE_DIR so we
// don't have to add an export surface to a pure-Node-no-deps file. Each test
// pre-populates `<STATE_DIR>/tasks/` with the JSON / log fixtures the AC
// describes, then curls the running dashboard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

// Pick a free high port at the OS level. The dashboard server's current
// announce log echoes the env-var PORT verbatim (not server.address().port),
// so we cannot rely on PORT=0 self-discovery — we pre-pick a port from a
// listener-then-close trick instead. Tests serialize via test.before/after
// so port reuse across files is fine, but each individual test gets a
// fresh port to avoid lingering-TIME_WAIT collisions.
import { createServer as createNetServer } from 'node:net';
const pickFreePort = () => new Promise((res, rej) => {
  const s = createNetServer();
  s.unref();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => res(port));
  });
});

// Wait for the server to actually accept TCP connections — the announce log
// is fired from server.listen's callback so it's a reliable signal, but the
// callback runs inside the listening event so we wait for either the log
// OR a successful probe.
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

// Spawn the dashboard server against a fresh STATE_DIR, return { base, kill }.
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
  // Surface fatal errors but otherwise swallow.
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

const writeClaimsAndEnvs = async (stateDir, claims, envs) => {
  await writeFile(join(stateDir, 'claims.json'), JSON.stringify(claims));
  await writeFile(join(stateDir, 'env-registry.json'), JSON.stringify(envs));
};

const writeTask = async (stateDir, taskId, doc) => {
  const tasksDir = join(stateDir, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, `${taskId}.json`), JSON.stringify(doc));
};

const writeTaskLog = async (stateDir, taskId, body) => {
  const tasksDir = join(stateDir, 'tasks');
  await mkdir(tasksDir, { recursive: true });
  await writeFile(join(tasksDir, `${taskId}.log`), body);
};

// Shared default claims/envs (no slots claimed; tests can override).
const DEFAULT_CLAIMS = [
  { slot: 1, claimed: false },
  { slot: 2, claimed: false },
];
const DEFAULT_ENVS = [];

let ctx;
test.before(async () => {
  ctx = { dir: null, srv: null };
});
test.after(async () => {
  if (ctx?.srv) await ctx.srv.kill();
  if (ctx?.dir) await rm(ctx.dir, { recursive: true, force: true });
});

const bootFreshFixture = async ({ claims = DEFAULT_CLAIMS, envs = DEFAULT_ENVS, tasks = {}, logs = {} } = {}) => {
  if (ctx.srv) await ctx.srv.kill();
  if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true });
  ctx.dir = await mkdtemp(join(tmpdir(), 'rl-dash-m3-'));
  await writeClaimsAndEnvs(ctx.dir, claims, envs);
  for (const [id, doc] of Object.entries(tasks)) await writeTask(ctx.dir, id, doc);
  for (const [id, body] of Object.entries(logs)) await writeTaskLog(ctx.dir, id, body);
  ctx.srv = await startServer(ctx.dir);
  return ctx;
};

// ============================================================================
// AC-M3-1: /api/state.active_tasks projection contains only summary fields and
// STRIPS sensitive fields from M1's task JSON.
// ============================================================================
test('AC-M3-1: /api/state projects task summary and strips sensitive fields', async () => {
  const fullDoc = {
    task_id: 'abc12345',
    tool: 'rl_validate_ci',
    slot: 1,
    args_summary: '--full',
    status: 'running',
    started_at: '2026-05-20T10:00:00Z',
    finished_at: null,
    // Sensitive — must NOT appear in the projection:
    pid: 4242,
    log_path: '/state/tasks/abc12345.log',
    cmd: ['rl', 'validate-ci', '--full', '--secret=abc'],
    agent_id: 'agent-deadbeef',
    exit_code: null,
    script_exit_code: null,
    mcp_runtime_status: 'running',
    steps: [{ name: 'lint', status: 'running' }],
    last_output_at: '2026-05-20T10:00:00Z',
    last_line: 'some output',
    current_step: 'lint',
    progress_hint: '5/12',
  };
  await bootFreshFixture({ tasks: { abc12345: fullDoc } });

  const res = await fetch(`${ctx.srv.base}/api/state`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.active_tasks), 'active_tasks must be an array');
  assert.equal(body.active_tasks.length, 1);
  const t = body.active_tasks[0];

  // Required projection fields:
  assert.equal(t.task_id, 'abc12345');
  assert.equal(t.tool, 'rl_validate_ci');
  assert.equal(t.slot, 1);
  assert.equal(t.args_summary, '--full');
  assert.equal(t.status, 'running');
  assert.equal(t.started_at, '2026-05-20T10:00:00Z');
  assert.equal(t.finished_at, null);
  assert.equal(typeof t.elapsed_seconds, 'number');
  assert.ok(t.elapsed_seconds >= 0, 'elapsed_seconds must be >= 0');

  // Sensitive-field strip — none of these must be present:
  for (const banned of [
    'pid', 'log_path', 'cmd', 'agent_id', 'exit_code', 'script_exit_code',
    'mcp_runtime_status', 'steps', 'last_output_at', 'last_line',
    'current_step', 'progress_hint',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(t, banned), false,
      `projection must NOT include sensitive field "${banned}"`);
  }
});

// ============================================================================
// AC-M3-2: terminal-window filter — succeeded/failed/cancelled tasks older
// than 1h excluded; within 1h included.
// ============================================================================
test('AC-M3-2: terminal-window filter (1h cutoff)', async () => {
  const now = Date.now();
  const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();
  const tasks = {
    fresh001: {
      task_id: 'fresh001', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'succeeded',
      started_at: minutesAgo(35), finished_at: minutesAgo(30),
    },
    stale002: {
      task_id: 'stale002', tool: 'rl_x', slot: 2, args_summary: '',
      status: 'failed',
      started_at: minutesAgo(125), finished_at: minutesAgo(120),
    },
    running3: {
      task_id: 'running3', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'running',
      started_at: minutesAgo(10), finished_at: null,
    },
    cancel04: {
      task_id: 'cancel04', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'cancelled',
      started_at: minutesAgo(20), finished_at: minutesAgo(15),
    },
  };
  await bootFreshFixture({ tasks });
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  const ids = body.active_tasks.map((t) => t.task_id).sort();
  // running3 always; fresh001 + cancel04 in-window; stale002 excluded.
  assert.deepEqual(ids, ['cancel04', 'fresh001', 'running3']);
});

// ============================================================================
// AC-M3-3 (server side): empty active_tasks when STATE_DIR/tasks/ missing.
// This is also AC-M3-12 graceful pre-M1 path.
// ============================================================================
test('AC-M3-12: missing tasks dir → active_tasks: []', async () => {
  // Do not create any tasks → no tasks/ dir created.
  await bootFreshFixture({});
  const res = await fetch(`${ctx.srv.base}/api/state`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.active_tasks, []);
});

// ============================================================================
// AC-M3-1b: skip-bad-JSON resilience (defense vs partial M1 writes).
// ============================================================================
test('AC-M3-skip-bad-files: malformed JSON files are skipped silently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rl-dash-m3-'));
  await writeClaimsAndEnvs(dir, DEFAULT_CLAIMS, DEFAULT_ENVS);
  await mkdir(join(dir, 'tasks'), { recursive: true });
  await writeFile(join(dir, 'tasks', 'bad00001.json'), '{not valid json');
  await writeTask(dir, 'goodtask', {
    task_id: 'goodtask', tool: 'rl_x', slot: 1, args_summary: '',
    status: 'running', started_at: new Date().toISOString(), finished_at: null,
  });
  if (ctx.srv) await ctx.srv.kill();
  if (ctx.dir) await rm(ctx.dir, { recursive: true, force: true });
  ctx.dir = dir;
  ctx.srv = await startServer(dir);
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  const ids = body.active_tasks.map((t) => t.task_id);
  assert.deepEqual(ids, ['goodtask']);
});

// ============================================================================
// AC-M3-skip-unknown-status: status outside known set is filtered.
// ============================================================================
test('AC-M3-skip-unknown-status: unknown status values are filtered', async () => {
  await bootFreshFixture({
    tasks: {
      weird001: {
        task_id: 'weird001', tool: 'rl_x', slot: 1, args_summary: '',
        status: 'mysterious', started_at: new Date().toISOString(), finished_at: null,
      },
      okok0002: {
        task_id: 'okok0002', tool: 'rl_x', slot: 1, args_summary: '',
        status: 'running', started_at: new Date().toISOString(), finished_at: null,
      },
    },
  });
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  const ids = body.active_tasks.map((t) => t.task_id);
  assert.deepEqual(ids, ['okok0002']);
});

// ============================================================================
// AC-M3-6: /api/tasks/<id>/log returns the file body as text/plain utf-8.
// ============================================================================
test('AC-M3-6: GET /api/tasks/<id>/log returns 200 text/plain', async () => {
  await bootFreshFixture({ logs: { abc12345: 'hello world\n' } });
  const res = await fetch(`${ctx.srv.base}/api/tasks/abc12345/log`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /^text\/plain; charset=utf-8/);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const body = await res.text();
  assert.ok(body.includes('hello world'), `body should include "hello world", got ${JSON.stringify(body)}`);
});

// ============================================================================
// AC-M3-7: tail cap at TASK_LOG_TAIL_BYTES (50 KiB default).
// ============================================================================
test('AC-M3-7: /api/tasks/<id>/log caps response at 50 KiB tail', async () => {
  // Make a 100 KiB log, last 50 KiB is unique sentinel string.
  const head = 'A'.repeat(50 * 1024);
  const tail = 'TAILMARKER_' + 'B'.repeat(50 * 1024 - 'TAILMARKER_'.length);
  await bootFreshFixture({ logs: { aaa11111: head + tail } });
  const res = await fetch(`${ctx.srv.base}/api/tasks/aaa11111/log`);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.ok(buf.length <= 51200, `response must be ≤ 51200 bytes, got ${buf.length}`);
  // The TAILMARKER must be present — the head must NOT be (we only return the tail).
  assert.ok(buf.toString('utf-8').includes('TAILMARKER_'), 'tail marker must be present');
});

// ============================================================================
// AC-M3-8: 404 on missing log file.
// ============================================================================
test('AC-M3-8: GET /api/tasks/<id>/log returns 404 Not Found when missing', async () => {
  await bootFreshFixture({});
  const res = await fetch(`${ctx.srv.base}/api/tasks/nosuch12/log`);
  assert.equal(res.status, 404);
  const ct = res.headers.get('content-type') || '';
  // The route handler MUST set text/plain (matches handleAttachmentGet
  // pattern). Pre-impl, the static fallback returns 404 with text/html
  // (or no content-type) — that's the failing TDD signal.
  assert.match(ct, /text\/plain/i, `404 must use text/plain content-type, got "${ct}"`);
  const body = await res.text();
  assert.equal(body, 'Not Found');
});

// ============================================================================
// AC-M3-9: 400 on invalid task_id (uppercase, special chars, too short/long).
// ============================================================================
test('AC-M3-9: GET /api/tasks/<id>/log returns 400 on invalid task_id', async () => {
  await bootFreshFixture({});
  for (const bad of [
    'THIS_HAS_UPPERCASE',
    'short',                 // < 8 chars
    'x'.repeat(33),          // > 32 chars
    'abc/../etc',            // path traversal
    'abc-1234',              // dash not allowed by regex
  ]) {
    const res = await fetch(`${ctx.srv.base}/api/tasks/${encodeURIComponent(bad)}/log`);
    // 400 OR a static-fallback 404 is acceptable for path-traversal-shaped
    // ids that the route regex won't match at all. The CRITICAL contract is
    // that ids matching the regex pattern get 400 explicitly. Restrict the
    // hard assertion to those that *should* hit the validator:
    if (/^[a-zA-Z0-9_]+$/.test(bad)) {
      assert.equal(res.status, 400, `expected 400 for invalid id "${bad}", got ${res.status}`);
      const body = await res.json();
      assert.equal(body.ok, false);
      assert.match(body.error || '', /invalid task_id/i);
    }
  }
});

// ============================================================================
// AC-M3-10: 405 on non-GET/HEAD method for /api/tasks/<id>/log.
// ============================================================================
test('AC-M3-10: POST /api/tasks/<id>/log returns 405 Method Not Allowed', async () => {
  await bootFreshFixture({ logs: { abc12345: 'x' } });
  const res = await fetch(`${ctx.srv.base}/api/tasks/abc12345/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 405);
});

// ============================================================================
// AC-M3-task-id-anchored-regex: route regex must be ANCHORED — appending an
// `.log` extension or path traversal MUST NOT match the route at all.
// ============================================================================
test('AC-M3-route-anchor: task_id regex is anchored + correct path resolves', async () => {
  // Positive: the canonical path /api/tasks/<id>/log MUST route to the
  // handler. A 200 (file present) OR 404-text/plain (file absent but route
  // matched) confirms the route is wired up. Pre-impl, the static fallback
  // returns 404 with HTML/no content-type, which fails this assertion.
  await bootFreshFixture({ logs: { abc12345: 'hi' } });
  const r0 = await fetch(`${ctx.srv.base}/api/tasks/abc12345/log`);
  assert.equal(r0.status, 200, 'canonical /api/tasks/<id>/log must match route');
  // Anchor: trailing extra path must NOT route to the handler — it should
  // hit the static catch-all (which 404s with no content-type / text/html).
  const r1 = await fetch(`${ctx.srv.base}/api/tasks/abc12345/log/extra`);
  assert.notEqual(r1.status, 200);
  // Prefix variant — different route entirely:
  const r2 = await fetch(`${ctx.srv.base}/api/tasks/abc12345/logz`);
  assert.notEqual(r2.status, 200);
});

// ============================================================================
// AC-M3-11 (server-side proxy): /api/state contains active_tasks key alongside
// slots[] and envs[]. The single-fetch contract from the client side is tested
// separately via Chrome MCP at the validate phase.
// ============================================================================
test('AC-M3-11 (server): /api/state ship active_tasks alongside slots/envs', async () => {
  await bootFreshFixture({});
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  for (const k of ['ok', 'slots', 'envs', 'active_tasks', 'public_domain', 'generated_at']) {
    assert.ok(k in body, `/api/state response missing key: ${k}`);
  }
});

// ============================================================================
// AC-M3-cap: collectActiveTasks caps at MAX_ACTIVE_TASKS (200).
// ============================================================================
test('AC-M3-cap: collectActiveTasks caps response at 200 entries', async () => {
  const tasks = {};
  for (let i = 0; i < 250; i++) {
    const id = `task${String(i).padStart(4, '0')}`;
    tasks[id] = {
      task_id: id, tool: 'rl_x', slot: 1, args_summary: '',
      status: 'running',
      // Stagger started_at so we can verify ordering: newer should be kept.
      started_at: new Date(Date.now() - i * 1000).toISOString(),
      finished_at: null,
    };
  }
  await bootFreshFixture({ tasks });
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  assert.ok(body.active_tasks.length <= 200,
    `active_tasks must cap at 200, got ${body.active_tasks.length}`);
});

// ============================================================================
// AC-M3-order: newest started_at first in active_tasks.
// ============================================================================
test('AC-M3-order: active_tasks sorted newest started_at first', async () => {
  const now = Date.now();
  const tasks = {
    oldoldld: {
      task_id: 'oldoldld', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'running',
      started_at: new Date(now - 5 * 60_000).toISOString(),
      finished_at: null,
    },
    middlemd: {
      task_id: 'middlemd', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'running',
      started_at: new Date(now - 2 * 60_000).toISOString(),
      finished_at: null,
    },
    newone00: {
      task_id: 'newone00', tool: 'rl_x', slot: 1, args_summary: '',
      status: 'running',
      started_at: new Date(now - 30_000).toISOString(),
      finished_at: null,
    },
  };
  await bootFreshFixture({ tasks });
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  const ids = body.active_tasks.map((t) => t.task_id);
  assert.deepEqual(ids, ['newone00', 'middlemd', 'oldoldld']);
});

// ============================================================================
// AC-M3-elapsed: elapsed_seconds = finished_at - started_at for terminal, or
// now - started_at for running. Clamped at >= 0 (clock skew defense).
// ============================================================================
test('AC-M3-elapsed: elapsed_seconds derived correctly per status', async () => {
  const now = Date.now();
  await bootFreshFixture({
    tasks: {
      term0001: {
        task_id: 'term0001', tool: 'rl_x', slot: 1, args_summary: '',
        status: 'succeeded',
        started_at: new Date(now - 120_000).toISOString(),    // 120s ago
        finished_at: new Date(now - 60_000).toISOString(),    // 60s ago → 60s elapsed
      },
      run00002: {
        task_id: 'run00002', tool: 'rl_x', slot: 1, args_summary: '',
        status: 'running',
        started_at: new Date(now - 30_000).toISOString(),     // 30s ago → ~30s elapsed
        finished_at: null,
      },
      future03: {
        // Clock skew defense — started in the future.
        task_id: 'future03', tool: 'rl_x', slot: 1, args_summary: '',
        status: 'running',
        started_at: new Date(now + 60_000).toISOString(),
        finished_at: null,
      },
    },
  });
  const res = await fetch(`${ctx.srv.base}/api/state`);
  const body = await res.json();
  const byId = Object.fromEntries(body.active_tasks.map((t) => [t.task_id, t]));
  // Terminal: 60s ± 2s.
  assert.ok(Math.abs(byId.term0001.elapsed_seconds - 60) <= 2,
    `terminal elapsed should be ~60s, got ${byId.term0001.elapsed_seconds}`);
  // Running: 30s ± 5s (give plenty of slack — server boot adds latency).
  assert.ok(byId.run00002.elapsed_seconds >= 25 && byId.run00002.elapsed_seconds <= 60,
    `running elapsed should be ~30s (±slack), got ${byId.run00002.elapsed_seconds}`);
  // Future-started: clamped to 0.
  assert.equal(byId.future03.elapsed_seconds, 0);
});
