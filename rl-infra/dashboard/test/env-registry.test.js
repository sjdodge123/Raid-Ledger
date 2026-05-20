// ROK-1331 M6b chunk-3 — consolidated env-registry read.
//
// `handleTestPlanPut` today calls `envExistsForSlug` AND `listEnvSlugs`
// (server.js:552-572) — two separate readFile() invocations of the same
// env-registry.json. M6b consolidates these into a single `loadEnvRegistry()`
// helper that:
//   1. Performs ONE readFile.
//   2. Returns `{ slugs: string[], byId: Map<string, object> }` (full entries
//      so M5b can layer queue state on top).
//   3. Emits console.warn for any entry missing a `slug` field (chunk-3 NIT).
//   4. ENOENT → empty registry; non-ENOENT (EACCES, JSON parse) → re-throws.
//
// We exercise it end-to-end against the running server: AC-M6b-12 checks the
// 409 path includes `available_envs` correctly; AC-M6b-13 checks the warn-log
// fires; AC-M6b-14 confirms single readFile via the source-grep shortcut.
//
// These tests MUST fail today — the helper does not yet exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
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
      if (m && !port) {
        port = parseInt(m[1], 10);
        resolveReady();
      }
    });
    child.stderr.on('data', (c) => { stderrBuf += c.toString('utf-8'); });
    child.once('error', rejectReady);
    child.once('exit', (code) => {
      if (!port) rejectReady(new Error(`server exited before ready (code=${code}): ${stderrBuf}`));
    });
    setTimeout(() => {
      if (!port) rejectReady(new Error(`server did not start within 5s: stderr=${stderrBuf}`));
    }, 5000).unref();
  });
  await ready;
  return {
    base: `http://127.0.0.1:${port}`,
    getStderr: () => stderrBuf,
    getStdout: () => stdoutBuf,
    kill: () => new Promise((r) => {
      child.once('exit', () => r());
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000).unref();
    }),
  };
};

let _ctx = null;
const bootFixture = async ({ envRegistry, claimsJson }) => {
  if (_ctx?.srv) await _ctx.srv.kill();
  if (_ctx?.dir) await rm(_ctx.dir, { recursive: true, force: true });
  const dir = await mkdtemp(join(tmpdir(), 'rl-dash-m6b-'));
  if (envRegistry !== undefined) {
    await writeFile(join(dir, 'env-registry.json'), typeof envRegistry === 'string' ? envRegistry : JSON.stringify(envRegistry));
  }
  if (claimsJson === undefined) {
    await writeFile(join(dir, 'claims.json'), JSON.stringify([
      { slot: 1, claimed: false },
      { slot: 2, claimed: false },
    ]));
  } else {
    await writeFile(join(dir, 'claims.json'), JSON.stringify(claimsJson));
  }
  const srv = await startServer(dir);
  _ctx = { dir, srv };
  return _ctx;
};

test.after(async () => {
  if (_ctx?.srv) await _ctx.srv.kill();
  if (_ctx?.dir) await rm(_ctx.dir, { recursive: true, force: true });
});

// AC-M6b-11: PUT /api/test-plans/<unknown-slug> returns 409 with
// `available_envs` populated from the consolidated loadEnvRegistry call.
test('AC-M6b-11: 409 path returns available_envs from consolidated read', async () => {
  const { srv } = await bootFixture({
    envRegistry: [
      { slug: 'slugA', slot: 1, ttl: 3600 },
      { slug: 'slugB', slot: 2, ttl: 3600 },
    ],
  });
  const res = await fetch(`${srv.base}/api/test-plans/missing-slug`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: [{ description: 'ok' }] }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'env_not_found');
  assert.deepEqual([...body.available_envs].sort(), ['slugA', 'slugB']);
});

// AC-M6b-12: env-registry.json corrupt (non-ENOENT) → 500 with explicit
// `env_registry_unreadable` error code (NOT a hung socket).
test('AC-M6b-12: corrupt env-registry returns 500 env_registry_unreadable', async () => {
  const { srv } = await bootFixture({
    envRegistry: '{not valid json{{{',  // raw string — will JSON.parse-fail
  });

  // Use AbortController to bound the request — if today's code hangs the
  // socket on the JSON.parse throw, this test would otherwise time out.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  let res;
  try {
    res = await fetch(`${srv.base}/api/test-plans/any-slug`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: [{ description: 'ok' }] }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'env_registry_unreadable');
  assert.ok(typeof body.detail === 'string' && body.detail.length > 0, 'detail must be a non-empty string');
});

// AC-M6b-13: env-registry entries missing `slug` → console.warn fires.
// We assert by tailing the server's stderr (where console.warn lands by
// default in node). Plan PUT for one valid slug still succeeds (the
// malformed entry is dropped, not fatal).
test('AC-M6b-13: missing-slug entries trigger console.warn', async () => {
  const { srv } = await bootFixture({
    envRegistry: [
      { slug: 'good', slot: 1 },
      { slot: 2 /* missing slug */ },
      { slug: null, slot: 3 /* explicit null slug */ },
    ],
  });
  // Trigger the load by hitting any endpoint that reads the registry.
  const res = await fetch(`${srv.base}/api/test-plans/nope`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: [{ description: 'ok' }] }),
  });
  assert.equal(res.status, 409);
  // The warn lands on stderr (console.warn default). Give the server a
  // beat to flush.
  await new Promise((r) => setTimeout(r, 100));
  const stderr = srv.getStderr();
  const combined = stderr + '\n' + srv.getStdout();
  assert.ok(
    /missing.*slug/i.test(combined) || /malformed/i.test(combined) || /invalid registry entry/i.test(combined),
    `console.warn for missing-slug entries expected; got stderr=${stderr.slice(-500)}`,
  );
});

// AC-M6b-14 (structural): `handleTestPlanPut` does ONE registry read, not two.
// Grep the source for the new helper name AND the absence of the two old
// helpers in the handler region. This is a structural assertion — it's a
// proxy for "single read" since instrumenting fs.readFile from a child
// process is brittle.
test('AC-M6b-14: handleTestPlanPut uses loadEnvRegistry (single read)', () => {
  const src = readFileSync(SERVER_PATH, 'utf-8');
  // The new helper MUST exist.
  assert.match(
    src,
    /(const|function)\s+loadEnvRegistry\b/,
    'expected `loadEnvRegistry` helper to be defined in server.js',
  );
  // Extract just the handleTestPlanPut function body for a tighter assertion.
  const m = src.match(/handleTestPlanPut\s*=\s*async[\s\S]+?\n\};/);
  assert.ok(m, 'could not locate handleTestPlanPut definition');
  const handlerBody = m[0];
  // The handler should call loadEnvRegistry but NOT both of the older helpers
  // (which would mean two reads).
  assert.match(handlerBody, /loadEnvRegistry/, 'handler should call loadEnvRegistry');
  const callsEnvExists = /envExistsForSlug\s*\(/.test(handlerBody);
  const callsListSlugs = /listEnvSlugs\s*\(/.test(handlerBody);
  assert.ok(
    !(callsEnvExists && callsListSlugs),
    'handler must not call BOTH envExistsForSlug AND listEnvSlugs (two reads); replace with loadEnvRegistry',
  );
});
