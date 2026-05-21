// ROK-1337 — Dashboard server multi-plan storage refactor (TDD red).
//
// Asserts the v2 endpoint shape:
//   PUT    /api/test-plans/{slug}/{plan_id}      → create one plan
//   GET    /api/test-plans/{slug}                → list ALL plans for slug
//   GET    /api/test-plans/{slug}/{plan_id}      → read one plan
//   POST   /api/test-plans/{slug}/{plan_id}/submit → submit verdicts for one
//   DELETE /api/test-plans/{slug}/{plan_id}      → clear one plan
//   DELETE /api/test-plans/{slug}                → clear ALL plans for slug
//
// Storage: per-plan files at TEST_PLANS_DIR/{slug}/{plan_id}.json
// Plan IDs follow /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/ (e.g.
// 2026-05-21-1530-7f3a).
//
// Required body fields on PUT: goal (3-7 words) + story_id (/^ROK-\d+$/).
//
// Deploy-time sweeper: any *.json file at TEST_PLANS_DIR/ root (legacy v1
// single-file format) is deleted on server startup.
//
// All tests in this file MUST fail against current server.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');

// Spawn a fresh dashboard server against a tmp state dir. Returns
// `{ base, stateDir, plansDir, kill, stderr() }`. PORT=0 → bound port
// is read from the announce log.
const startServer = async (opts = {}) => {
  const stateDir =
    opts.stateDir || (await mkdtemp(join(tmpdir(), 'rl-dash-rok1337-')));
  const plansDir = join(stateDir, 'test-plans');
  // Pre-create claims.json + env-registry.json so the PUT handler's
  // env-existence guard accepts any slug we register.
  await writeFile(
    join(stateDir, 'claims.json'),
    JSON.stringify([
      { slot: 1, claimed: false },
      { slot: 2, claimed: false },
    ]),
  );
  await writeFile(
    join(stateDir, 'env-registry.json'),
    JSON.stringify(
      opts.envs || [{ slug: 'foo' }, { slug: 'bar' }, { slug: 'baz' }],
    ),
  );

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: '0',
      STATE_DIR: stateDir,
      TEST_PLANS_DIR: plansDir,
      PUBLIC_DIR,
      RL_AGENT_TOKEN: 'test-token-not-used',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let port = null;
  let stderrBuf = '';
  let stdoutBuf = '';
  await new Promise((resolveReady, rejectReady) => {
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf-8');
      const m = stdoutBuf.match(/listening on :(\d+)/);
      if (m && !port) {
        port = parseInt(m[1], 10);
        resolveReady();
      }
    });
    child.stderr.on('data', (c) => {
      stderrBuf += c.toString('utf-8');
    });
    child.once('error', rejectReady);
    child.once('exit', (code) => {
      if (!port)
        rejectReady(
          new Error(`server exit before ready (code=${code}): ${stderrBuf}`),
        );
    });
    setTimeout(() => {
      if (!port) rejectReady(new Error(`server timeout: stderr=${stderrBuf}`));
    }, 5000).unref();
  });

  return {
    base: `http://127.0.0.1:${port}`,
    stateDir,
    plansDir,
    stderr: () => stderrBuf,
    kill: () =>
      new Promise((r) => {
        child.once('exit', () => r());
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 1000).unref();
      }),
  };
};

// Track contexts for cleanup. Each test pushes its own; teardown
// drains the stack.
const _ctxs = [];
test.after(async () => {
  while (_ctxs.length) {
    const c = _ctxs.pop();
    if (c?.srv) {
      try {
        await c.srv.kill();
      } catch {}
    }
    if (c?.srv?.stateDir) {
      try {
        await rm(c.srv.stateDir, { recursive: true, force: true });
      } catch {}
    }
  }
});

const PLAN_ID_A = '2026-05-21-1530-7f3a';
const PLAN_ID_B = '2026-05-21-1535-aaaa';

const goodPlanBody = (overrides = {}) => ({
  goal: 'validate oauth flow',
  story_id: 'ROK-1337',
  steps: [{ description: 'open /lineups; expect 3 rows' }],
  ...overrides,
});

const put = (base, slug, planId, body) =>
  fetch(`${base}/api/test-plans/${slug}/${planId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

// ============================================================
// AC15 — PUT /api/test-plans/{slug}/{plan_id} creates a file at
// {plansDir}/{slug}/{plan_id}.json (and creates {slug}/ if missing).
// ============================================================
test('AC15: PUT {slug}/{plan_id} writes file under per-slug subdirectory', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  const r = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody());
  assert.equal(r.status, 201, `expected 201, got ${r.status}`);

  // The per-plan file must live at {plansDir}/foo/{plan_id}.json.
  const expected = join(srv.plansDir, 'foo', `${PLAN_ID_A}.json`);
  const s = await stat(expected);
  assert.ok(s.isFile(), `expected file at ${expected}`);

  // The legacy v1 file location {plansDir}/foo.json MUST NOT exist.
  const v1Path = join(srv.plansDir, 'foo.json');
  await assert.rejects(stat(v1Path), /ENOENT/);
});

// ============================================================
// AC16 — Two PUTs to two different plan_ids on the SAME slug
// produce two files in {slug}/, both readable.
// ============================================================
test('AC16: two PUTs on same slug → two files in {slug}/ subdir', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  const a = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'plan one alpha' }));
  const b = await put(srv.base, 'foo', PLAN_ID_B, goodPlanBody({ goal: 'plan two beta' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const files = await readdir(join(srv.plansDir, 'foo'));
  const jsons = files.filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(jsons.sort(), [`${PLAN_ID_A}.json`, `${PLAN_ID_B}.json`].sort());
});

// ============================================================
// AC17 — GET /api/test-plans/{slug} returns {plans: [...]} with ALL
// plans for that slug, newest first.
// ============================================================
test('AC17: GET {slug} returns {plans: [...]} with all plans, newest first', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'oldest plan alpha' }));
  // Small delay so created_at differs measurably.
  await new Promise((r) => setTimeout(r, 20));
  await put(srv.base, 'foo', PLAN_ID_B, goodPlanBody({ goal: 'newest plan beta' }));

  const r = await fetch(`${srv.base}/api/test-plans/foo`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.plans), `expected body.plans array, got ${JSON.stringify(body)}`);
  assert.equal(body.plans.length, 2);
  // Newest first: PLAN_ID_B (created later) must come before PLAN_ID_A.
  const ids = body.plans.map((p) => p.plan_id ?? p.id);
  assert.deepEqual(ids, [PLAN_ID_B, PLAN_ID_A], `plans must be sorted newest-first; got ${JSON.stringify(ids)}`);
});

// ============================================================
// AC18 — GET /api/test-plans/{slug}/{plan_id} returns just that plan.
// ============================================================
test('AC18: GET {slug}/{plan_id} returns single plan', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'first plan alpha' }));
  await put(srv.base, 'foo', PLAN_ID_B, goodPlanBody({ goal: 'second plan beta' }));

  const r = await fetch(`${srv.base}/api/test-plans/foo/${PLAN_ID_A}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  // Response shape: must surface the plan_id and the chosen goal so we
  // can tell which plan was returned. Don't pin the outer wrapper too
  // tightly — `body.plan` OR `body` at top-level are both acceptable
  // post-v2; we look in both spots.
  const plan = body.plan ?? body;
  assert.equal(plan.plan_id ?? plan.id, PLAN_ID_A);
  assert.equal(plan.goal, 'first plan alpha');
});

// ============================================================
// AC19 — PUT rejects body missing goal with 400 mentioning "goal".
// ============================================================
test('AC19: PUT missing goal → 400 with goal in error', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  const r = await put(srv.base, 'foo', PLAN_ID_A, {
    // no goal
    story_id: 'ROK-1337',
    steps: [{ description: 'x' }],
  });
  assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  const body = await r.json();
  assert.equal(body.ok, false);
  assert.match(JSON.stringify(body), /goal/i);
});

// ============================================================
// AC20 — PUT rejects body missing story_id with 400 mentioning "story_id".
// ============================================================
test('AC20: PUT missing story_id → 400 with story_id in error', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  const r = await put(srv.base, 'foo', PLAN_ID_A, {
    goal: 'validate oauth flow',
    // no story_id
    steps: [{ description: 'x' }],
  });
  assert.equal(r.status, 400, `expected 400, got ${r.status}`);
  const body = await r.json();
  assert.equal(body.ok, false);
  assert.match(JSON.stringify(body), /story_id/i);
});

// ============================================================
// AC21 — PUT rejects malformed goal (1 word, 8 words) and malformed
// story_id (lowercase, wrong format) with 400.
// ============================================================
test('AC21: PUT malformed goal/story_id → 400', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  // Goal: 1 word (too short).
  const r1 = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'oneword' }));
  assert.equal(r1.status, 400, `1-word goal should be 400; got ${r1.status}`);

  // Goal: 8 words (too long).
  const r2 = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'one two three four five six seven eight' }));
  assert.equal(r2.status, 400, `8-word goal should be 400; got ${r2.status}`);

  // story_id: lowercase.
  const r3 = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ story_id: 'rok-1337' }));
  assert.equal(r3.status, 400, `lowercase story_id should be 400; got ${r3.status}`);

  // story_id: wrong shape.
  const r4 = await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ story_id: 'foo-1234' }));
  assert.equal(r4.status, 400, `foo-1234 story_id should be 400; got ${r4.status}`);
});

// ============================================================
// AC22 — POST .../submit on one plan does not modify the other plan
// in the same slug.
// ============================================================
test('AC22: submit on plan A leaves plan B untouched', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'plan one alpha' }));
  await put(srv.base, 'foo', PLAN_ID_B, goodPlanBody({ goal: 'plan two beta' }));

  // Capture B's state pre-submit so we can compare bytes after.
  const bPathOnDisk = join(srv.plansDir, 'foo', `${PLAN_ID_B}.json`);
  const bBefore = await readFile(bPathOnDisk, 'utf-8');

  // Submit a verdict on plan A.
  const sub = await fetch(
    `${srv.base}/api/test-plans/foo/${PLAN_ID_A}/submit`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tester: 'jake',
        verdicts: [{ step_id: 1, verdict: 'pass' }],
      }),
    },
  );
  assert.equal(sub.status, 200, `submit should be 200; got ${sub.status}`);

  // Plan B's bytes on disk must be unchanged.
  const bAfter = await readFile(bPathOnDisk, 'utf-8');
  assert.equal(bAfter, bBefore, 'plan B was modified by a submit targeting plan A');
});

// ============================================================
// AC23 — DELETE /api/test-plans/{slug}/{plan_id} removes one file;
// slug dir + other plans intact.
// ============================================================
test('AC23: DELETE {slug}/{plan_id} removes only that file', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  await put(srv.base, 'foo', PLAN_ID_A, goodPlanBody({ goal: 'plan one alpha' }));
  await put(srv.base, 'foo', PLAN_ID_B, goodPlanBody({ goal: 'plan two beta' }));

  const r = await fetch(`${srv.base}/api/test-plans/foo/${PLAN_ID_A}`, {
    method: 'DELETE',
  });
  assert.equal(r.status, 200);

  // A's file is gone.
  await assert.rejects(
    stat(join(srv.plansDir, 'foo', `${PLAN_ID_A}.json`)),
    /ENOENT/,
  );
  // B's file still exists.
  const bStat = await stat(join(srv.plansDir, 'foo', `${PLAN_ID_B}.json`));
  assert.ok(bStat.isFile());
  // slug dir still exists.
  const dirStat = await stat(join(srv.plansDir, 'foo'));
  assert.ok(dirStat.isDirectory());
});

// ============================================================
// AC24 — DELETE /api/test-plans/{slug} removes the whole {slug}/ dir.
// ============================================================
test('AC24: DELETE {slug} removes the whole {slug}/ directory', async () => {
  const srv = await startServer();
  _ctxs.push({ srv });

  // Seed two plan files directly on disk under the per-slug subdir so we
  // don't depend on the (still-broken) PUT route. The v2 DELETE handler
  // must traverse the directory and remove all of it.
  await mkdir(join(srv.plansDir, 'foo'), { recursive: true });
  await writeFile(
    join(srv.plansDir, 'foo', `${PLAN_ID_A}.json`),
    JSON.stringify({ plan_id: PLAN_ID_A, slug: 'foo', goal: 'a b c', story_id: 'ROK-1' }),
    'utf-8',
  );
  await writeFile(
    join(srv.plansDir, 'foo', `${PLAN_ID_B}.json`),
    JSON.stringify({ plan_id: PLAN_ID_B, slug: 'foo', goal: 'd e f', story_id: 'ROK-1' }),
    'utf-8',
  );
  // Sanity-check the seed.
  const seeded = await readdir(join(srv.plansDir, 'foo'));
  assert.equal(seeded.length, 2, `seed must have placed 2 files; saw ${seeded.length}`);

  const r = await fetch(`${srv.base}/api/test-plans/foo`, { method: 'DELETE' });
  assert.equal(r.status, 200, `DELETE should be 200; got ${r.status}`);

  // {slug}/ directory should be gone (not just emptied). Today's v1
  // handler calls unlink(planPath(slug)) on TEST_PLANS_DIR/foo.json
  // (a FILE path), which doesn't exist → 200 noop. The {slug}/ dir
  // stays intact → this stat must succeed (i.e. NOT reject) and the
  // assertion `assert.rejects(...)` then fails today.
  await assert.rejects(
    stat(join(srv.plansDir, 'foo')),
    /ENOENT/,
    'DELETE {slug} must remove the entire {slug}/ directory (recursive)',
  );
});

// ============================================================
// AC25 — Deploy-time sweeper: at server boot, any *.json directly
// inside TEST_PLANS_DIR (legacy v1 single-file plans) is deleted.
// ============================================================
test('AC25: deploy-time sweeper deletes legacy v1 plan files at boot', async () => {
  // Pre-create the plans dir with a v1 legacy file BEFORE starting the
  // server. The server's startup sweeper should delete it.
  const stateDir = await mkdtemp(join(tmpdir(), 'rl-dash-rok1337-sweeper-'));
  const plansDir = join(stateDir, 'test-plans');
  await mkdir(plansDir, { recursive: true });
  const legacyPath = join(plansDir, 'old-slug.json');
  await writeFile(
    legacyPath,
    JSON.stringify({ slug: 'old-slug', steps: [] }),
    'utf-8',
  );
  // Also drop a sibling *directory* the sweeper must LEAVE alone (v2
  // multi-plan slug).
  await mkdir(join(plansDir, 'keep-me'), { recursive: true });
  await writeFile(
    join(plansDir, 'keep-me', `${PLAN_ID_A}.json`),
    JSON.stringify({ plan_id: PLAN_ID_A, goal: 'keep me alpha', story_id: 'ROK-1' }),
    'utf-8',
  );

  const srv = await startServer({ stateDir });
  _ctxs.push({ srv });

  // Give the sweeper a moment to fire if it's async.
  await new Promise((r) => setTimeout(r, 200));

  // Legacy file: gone.
  await assert.rejects(
    stat(legacyPath),
    /ENOENT/,
    'sweeper must delete TEST_PLANS_DIR/old-slug.json (legacy v1)',
  );
  // Sibling directory + its plan: untouched.
  const keepDir = await stat(join(plansDir, 'keep-me'));
  assert.ok(keepDir.isDirectory(), 'sweeper must NOT remove slug subdirectories');
  const keepPlan = await stat(join(plansDir, 'keep-me', `${PLAN_ID_A}.json`));
  assert.ok(keepPlan.isFile(), 'sweeper must NOT touch files inside slug subdirs');
});
