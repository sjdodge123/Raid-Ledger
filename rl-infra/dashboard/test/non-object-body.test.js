// ROK-1848 — a non-object JSON body must not crash the dashboard process.
//
// Before the fix, `readJsonBody` resolved any JSON value: the body `null`
// skipped the `|| '{}'` fallback, every POST/PUT handler then read
// `body.<field>` off null, the async request callback had no try/catch,
// and the unhandled rejection exited Node. One anonymous request took the
// dashboard (and every rl_test_plan_* tool) down.
//
// Each scenario spawns its own server and finishes by proving the SAME
// child process is still alive and `/api/state` answers 200.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const PLAN_ID = '2026-10-18-1200-abcd';
// ROK-1847 gates every mutating route behind the agent token (which the
// tester gate also accepts), so each request carries it: the body check is
// what these cases prove, not the auth gate.
const AGENT_TOKEN = 'rok-1848-null-body-agent-token';
const NON_OBJECT_BODIES = ['null', '[]', '"x"', '1'];

const waitForPort = (child, out) =>
  new Promise((ok, fail) => {
    child.stdout.on('data', (c) => {
      out.stdout += c.toString('utf-8');
      const m = out.stdout.match(/listening on :(\d+)/);
      if (m && !out.port) { out.port = Number(m[1]); ok(); }
    });
    child.once('exit', (code) => { if (!out.port) fail(new Error(`exit ${code}: ${out.stderr}`)); });
    setTimeout(() => { if (!out.port) fail(new Error(`timeout: ${out.stderr}`)); }, 5000).unref();
  });

const startServer = async (t, nodeArgs = []) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'rl-dash-rok1848-'));
  const plansDir = join(stateDir, 'test-plans');
  await writeFile(join(stateDir, 'claims.json'), JSON.stringify([{ slot: 1, claimed: false }]));
  await writeFile(join(stateDir, 'env-registry.json'), JSON.stringify([{ slug: 'foo' }]));
  const child = spawn(process.execPath, [...nodeArgs, SERVER_PATH], {
    env: {
      ...process.env,
      PORT: '0',
      STATE_DIR: stateDir,
      TEST_PLANS_DIR: plansDir,
      PUBLIC_DIR,
      RL_AGENT_TOKEN: AGENT_TOKEN,
      // Loopback is a trusted proxy so each request can carry its own
      // X-Forwarded-For and stay under the 30 POST/min per-IP limiter.
      RL_TRUSTED_PROXY_CIDRS: '127.0.0.1,::ffff:127.0.0.1,::1',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = { port: 0, stdout: '', stderr: '', exitCode: null };
  child.stderr.on('data', (c) => { out.stderr += c.toString('utf-8'); });
  child.on('exit', (code) => { out.exitCode = code ?? 'signal'; });
  await waitForPort(child, out);
  t.after(async () => {
    if (out.exitCode === null) {
      await new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); });
    }
    await rm(stateDir, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${out.port}`, plansDir, out };
};

let ipSeq = 0;
// Returns the HTTP status, or the transport error code when the server
// dropped the connection (the pre-fix crash shows up as a socket error).
const send = async (base, method, path, rawBody) => {
  ipSeq += 1;
  try {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-agent-token': AGENT_TOKEN,
        'x-forwarded-for': `10.18.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`,
      },
      body: rawBody,
    });
    return { status: r.status, text: await r.text() };
  } catch (err) {
    return { status: `transport-error:${err.cause?.code ?? err.message}`, text: '' };
  }
};

const assertStillAlive = async (srv) => {
  assert.equal(srv.out.exitCode, null, `dashboard process exited: ${srv.out.stderr}`);
  const r = await send(srv.base, 'GET', '/api/state');
  assert.equal(r.status, 200, '/api/state must answer 200 from the same process');
};

const validPlan = (steps) =>
  JSON.stringify({ goal: 'checks null body handling', story_id: 'ROK-1848', steps });

const MUTATING_ROUTES = [
  ['PUT', `/api/test-plans/foo/${PLAN_ID}`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}/submit`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}/step/1/result`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}/step/1/reset-request`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}/step/1/comment`],
  ['POST', `/api/test-plans/foo/${PLAN_ID}/attachment`],
  ['POST', '/api/perf-emit'],
];

test('AC1/AC5: every POST/PUT route answers 400 to a non-object body and the process survives', async (t) => {
  const srv = await startServer(t);
  // A plan must exist so the step/submit handlers get past their 404 guard
  // on the pre-fix code and reach the body dereference.
  const created = await send(srv.base, 'PUT', `/api/test-plans/foo/${PLAN_ID}`, validPlan([{ description: 'one' }]));
  assert.equal(created.status, 201, created.text);
  for (const [method, path] of MUTATING_ROUTES) {
    for (const raw of NON_OBJECT_BODIES) {
      const r = await send(srv.base, method, path, raw);
      assert.equal(r.status, 400, `${method} ${path} body=${raw} -> ${r.status} ${r.text}`);
    }
  }
  await assertStillAlive(srv);
});

test('AC2: steps[] with a non-object item is a 400, not a crash', async (t) => {
  const srv = await startServer(t);
  for (const steps of [[null], ['x'], [1], [[]], [{ description: 'ok' }, null]]) {
    const r = await send(srv.base, 'PUT', `/api/test-plans/foo/${PLAN_ID}`, validPlan(steps));
    assert.equal(r.status, 400, `steps=${JSON.stringify(steps)} -> ${r.status} ${r.text}`);
  }
  await assertStillAlive(srv);
});

test('AC2: verdicts[] with a non-object item is a 400, not a crash', async (t) => {
  const srv = await startServer(t);
  const created = await send(srv.base, 'PUT', `/api/test-plans/foo/${PLAN_ID}`, validPlan([{ description: 'one' }]));
  assert.equal(created.status, 201, created.text);
  for (const verdicts of [[null], ['pass'], [1], [[]], [{ step_id: 1, verdict: 'pass' }, null]]) {
    const r = await send(srv.base, 'POST', `/api/test-plans/foo/${PLAN_ID}/submit`, JSON.stringify({ verdicts }));
    assert.equal(r.status, 400, `verdicts=${JSON.stringify(verdicts)} -> ${r.status} ${r.text}`);
  }
  await assertStillAlive(srv);
});

test('AC3: a handler that throws gets a generic 500 that does not echo err.message', async (t) => {
  const srv = await startServer(t);
  // A directory where the plan file should be makes readFile throw EISDIR,
  // which handleTestPlanPut re-throws (it only swallows ENOENT).
  await mkdir(join(srv.plansDir, 'foo', `${PLAN_ID}.json`), { recursive: true });
  const r = await send(srv.base, 'PUT', `/api/test-plans/foo/${PLAN_ID}`, validPlan([{ description: 'one' }]));
  assert.equal(r.status, 500, `${r.status} ${r.text}`);
  assert.deepEqual(JSON.parse(r.text), { ok: false, error: 'internal_error' });
  assert.doesNotMatch(r.text, /EISDIR|\/test-plans\//);
  assert.match(srv.out.stderr, /EISDIR/, 'the error is logged server-side');
  await assertStillAlive(srv);
});

// Waits for a stderr line matching `re`, failing (not hanging) after 5s.
const waitForStderr = (srv, re) =>
  new Promise((ok, fail) => {
    const started = Date.now();
    const tick = () => {
      if (re.test(srv.out.stderr)) return ok();
      if (srv.out.exitCode !== null) return fail(new Error(`process exited: ${srv.out.stderr}`));
      if (Date.now() - started > 5000) return fail(new Error(`no ${re} in stderr: ${srv.out.stderr}`));
      setTimeout(tick, 20);
    };
    tick();
  });

test('AC4: a stray unhandled rejection is logged and does not exit the process', async (t) => {
  // The preload rejects a promise nobody awaits, once server.js has loaded
  // and registered its process-level backstop.
  const stray = "setTimeout(() => { Promise.reject(new Error('rok1848-stray-rejection')); }, 100);";
  const srv = await startServer(t, ['--import', `data:text/javascript,${encodeURIComponent(stray)}`]);
  await waitForStderr(srv, /unhandled_rejection[\s\S]*rok1848-stray-rejection/);
  await assertStillAlive(srv);
});
