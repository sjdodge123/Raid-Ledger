// ROK-1331 M6b chunk-3 — handleTestPlanPut hardening.
//
// Today (server.js:574-590), `envExistsForSlug` and `listEnvSlugs` re-throw
// any non-ENOENT error. The PUT handler does NOT wrap the throw → request
// dies with an unhandled rejection AND the socket hangs (no HTTP response).
//
// M6b wraps the registry call in try/catch and returns a structured 500
// response (`env_registry_unreadable`). This file asserts:
//   - EACCES on env-registry.json → 500 (not hang)
//   - JSON parse error → 500 (not hang)
//   - The error message in `detail` is informative
//   - The HTTP socket is properly closed (response complete, not a hang)
//
// We don't try to *actually* chmod 000 in CI (containers / runners often
// don't preserve perms). Instead: write a directory at the path so the read
// gets EISDIR — also a non-ENOENT error that exercises the catch path.
//
// These tests MUST fail today.

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

const startServer = async (stateDir) => {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: '0',
      STATE_DIR: stateDir,
      PUBLIC_DIR,
      RL_AGENT_TOKEN: 'test-token-not-used',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let port = null;
  let stderrBuf = '';
  let stdoutBuf = '';
  const ready = new Promise((resolveReady, rejectReady) => {
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf-8');
      const m = stdoutBuf.match(/listening on :(\d+)/);
      if (m && !port) { port = parseInt(m[1], 10); resolveReady(); }
    });
    child.stderr.on('data', (c) => { stderrBuf += c.toString('utf-8'); });
    child.once('error', rejectReady);
    child.once('exit', (code) => {
      if (!port) rejectReady(new Error(`server exit before ready (code=${code}): ${stderrBuf}`));
    });
    setTimeout(() => {
      if (!port) rejectReady(new Error(`server timeout: stderr=${stderrBuf}`));
    }, 5000).unref();
  });
  await ready;
  return {
    base: `http://127.0.0.1:${port}`,
    getStderr: () => stderrBuf,
    kill: () => new Promise((r) => {
      child.once('exit', () => r());
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000).unref();
    }),
  };
};

let _ctx = null;
test.after(async () => {
  if (_ctx?.srv) await _ctx.srv.kill();
  if (_ctx?.dir) await rm(_ctx.dir, { recursive: true, force: true });
});

// AC-M6b-15: env-registry.json is a directory (EISDIR) → handler returns 500
// (not hang). Verified via a bounded fetch with AbortController.
test('AC-M6b-15: non-ENOENT registry error returns 500, NOT a hung socket', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rl-dash-m6b-pput-'));
  // Make env-registry.json a DIRECTORY so readFile throws EISDIR.
  await mkdir(join(dir, 'env-registry.json'), { recursive: true });
  await writeFile(join(dir, 'claims.json'), JSON.stringify([
    { slot: 1, claimed: false },
    { slot: 2, claimed: false },
  ]));
  const srv = await startServer(dir);
  _ctx = { dir, srv };

  // 3s timeout: today's hung-socket bug would never resolve, so this would
  // abort. Post-fix the response should come back in milliseconds.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  let response;
  let aborted = false;
  try {
    // ROK-1337 — PUT now requires a {plan_id} segment AND goal/story_id in
    // the body. Use shape-valid values so we exercise the registry-read
    // path (not the early shape guards that return 400 before the read).
    response = await fetch(`${srv.base}/api/test-plans/anyslug/2026-05-21-1530-7f3a`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'validate registry error path',
        story_id: 'ROK-1337',
        steps: [{ description: 'ok' }],
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      aborted = true;
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  assert.equal(aborted, false, 'handler hung the socket — try/catch around loadEnvRegistry missing');
  assert.equal(response.status, 500, 'should return 500 on non-ENOENT registry error');
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'env_registry_unreadable');
  assert.ok(typeof body.detail === 'string', 'detail must be a string');
  assert.ok(body.detail.length > 0, 'detail must be non-empty');
});

// AC-M6b-16: handler does NOT crash the server process when the read fails.
// After the 500, a subsequent valid request (e.g. /api/state) still works.
test('AC-M6b-16: server survives the 500 — subsequent requests still succeed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rl-dash-m6b-pput-survive-'));
  // env-registry.json contains garbage JSON.
  await writeFile(join(dir, 'env-registry.json'), '{not}json{{', 'utf-8');
  await writeFile(join(dir, 'claims.json'), JSON.stringify([
    { slot: 1, claimed: false },
    { slot: 2, claimed: false },
  ]));
  const srv = await startServer(dir);
  if (_ctx?.srv) await _ctx.srv.kill();
  if (_ctx?.dir) await rm(_ctx.dir, { recursive: true, force: true });
  _ctx = { dir, srv };

  // First: PUT triggers the 500 (registry parse error). ROK-1337 — URL needs
  // {plan_id} segment AND body needs goal/story_id; shape gates run first
  // so we use valid values to make sure the registry-read path actually
  // executes.
  const r1 = await fetch(`${srv.base}/api/test-plans/foo/2026-05-21-1530-7f3a`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goal: 'validate registry parse error',
      story_id: 'ROK-1337',
      steps: [{ description: 'ok' }],
    }),
  });
  assert.equal(r1.status, 500);

  // Second: another endpoint still answers (server didn't crash).
  const r2 = await fetch(`${srv.base}/healthz`);
  // /healthz may or may not exist; /api/state should always work in this
  // dashboard. Probe both — at least one must answer 200.
  if (r2.status !== 200) {
    const r3 = await fetch(`${srv.base}/api/state`);
    assert.ok([200, 500].includes(r3.status), `/api/state should still answer post-500; got ${r3.status}`);
    // 500 here is acceptable (same EJSON parse error from /api/state's own
    // registry read) — the bar is the server process didn't crash. Only a
    // crash would yield ECONNREFUSED on the second fetch.
  }
});
