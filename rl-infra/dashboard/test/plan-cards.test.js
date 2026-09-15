// ROK-1575 — the dashboard TESTS section draws ONE card per PLAN.
//
// Before this story the section drew one card per SLUG, taking goal +
// story_id from the newest plan and summing the counts of every plan on
// that slug. On a shared env (`rok1564a`, 9 plans) the card claimed
// "ROK-1563 · 31 of 31 need a verdict · 9 plans" and its link opened a
// ROK-1564 plan — the operator tapped a 1563 button and landed on 1564.
//
// Two halves here:
//   server   — GET /api/test-plans carries a per-PLAN `plans[]` list
//              alongside the (still needed) per-slug `summaries` map.
//   frontend — the TESTS section renders one card per plan, each linking
//              to `/?slug=<slug>&plan=<plan_id>`, and the tester page
//              honours `?plan=` over the sticky localStorage value.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_PATH = resolve(__dirname, '..', 'server.js');
const PUBLIC_DIR = resolve(__dirname, '..', 'public');
const APP_JS = resolve(__dirname, '..', 'public', 'app.js');

// ---------------------------------------------------------------- server

/** Spawn the dashboard against a throwaway state dir on an ephemeral port. */
const startServer = async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'rl-dash-rok1575-'));
  const plansDir = join(stateDir, 'test-plans');
  await writeFile(join(stateDir, 'claims.json'), JSON.stringify([{ slot: 1, claimed: false }]));
  await writeFile(join(stateDir, 'env-registry.json'), JSON.stringify([{ slug: 'rok1564a' }, { slug: 'solo' }]));
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, PORT: '0', STATE_DIR: stateDir, TEST_PLANS_DIR: plansDir, PUBLIC_DIR, RL_AGENT_TOKEN: 'unused', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let port = null;
  let out = '';
  let errBuf = '';
  child.stderr.on('data', (c) => { errBuf += c.toString('utf-8'); });
  await new Promise((ready, fail) => {
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf-8');
      const m = out.match(/listening on :(\d+)/);
      if (m && !port) { port = parseInt(m[1], 10); ready(); }
    });
    child.once('error', fail);
    setTimeout(() => { if (!port) fail(new Error(`server timeout: ${errBuf}`)); }, 5000).unref();
  });
  return {
    base: `http://127.0.0.1:${port}`,
    plansDir,
    stateDir,
    kill: () => new Promise((r) => { child.once('exit', () => r()); child.kill('SIGTERM'); }),
  };
};

const _servers = [];
test.after(async () => {
  while (_servers.length) {
    const s = _servers.pop();
    try { await s.kill(); } catch { /* already gone */ }
    try { await rm(s.stateDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** Write a plan file straight into the slug dir (bypasses PUT validation). */
const seedPlan = async (srv, slug, planId, plan) => {
  await mkdir(join(srv.plansDir, slug), { recursive: true });
  await writeFile(join(srv.plansDir, slug, `${planId}.json`), JSON.stringify({
    plan_id: planId,
    created_at: plan.created_at,
    goal: plan.goal,
    story_id: plan.story_id,
    title: plan.title ?? plan.goal,
    steps: plan.steps,
  }));
};

const step = (id, verdict) => ({
  id,
  description: `step ${id}`,
  results: verdict ? [{ verdict, ts: '2026-09-15T10:00:00.000Z', tester: 'op' }] : [],
});

test('ROK-1575 server: GET /api/test-plans returns one entry per PLAN with its own story/goal/counts', async () => {
  const srv = await startServer();
  _servers.push(srv);

  await seedPlan(srv, 'rok1564a', '2026-09-15-1000-aaaa', {
    created_at: '2026-09-15T09:00:00.000Z',
    goal: 'Decide on the WoW Forever catalog row',
    story_id: 'ROK-1563',
    steps: [step('s1', 'pass'), step('s2')],
  });
  await seedPlan(srv, 'rok1564a', '2026-09-15-1100-bbbb', {
    created_at: '2026-09-15T11:00:00.000Z',
    goal: 'Check the one-question game-time prompt',
    story_id: 'ROK-1564',
    steps: [step('s1'), step('s2'), step('s3')],
  });

  const r = await fetch(`${srv.base}/api/test-plans`);
  assert.equal(r.status, 200);
  const j = await r.json();

  // The per-slug summaries map stays — the env cards still consume it.
  assert.ok(j.summaries?.rok1564a, 'per-slug summaries must still be served');
  assert.equal(j.summaries.rok1564a.plan_count, 2);

  assert.ok(Array.isArray(j.plans), 'response must carry a plans[] array');
  assert.equal(j.plans.length, 2, 'two plans on one slug → two entries');

  // Newest first.
  assert.equal(j.plans[0].plan_id, '2026-09-15-1100-bbbb');
  assert.equal(j.plans[1].plan_id, '2026-09-15-1000-aaaa');

  const older = j.plans[1];
  assert.equal(older.slug, 'rok1564a');
  assert.equal(older.story_id, 'ROK-1563', 'each entry carries its OWN story_id, not the newest plan\'s');
  assert.equal(older.goal, 'Decide on the WoW Forever catalog row');
  assert.equal(older.total, 2, 'counts are per-plan, not summed across the slug');
  assert.equal(older.pending, 1);
  assert.equal(older.pass, 1);

  const newer = j.plans[0];
  assert.equal(newer.story_id, 'ROK-1564');
  assert.equal(newer.total, 3);
  assert.equal(newer.pending, 3);
  assert.equal(typeof newer.last_updated_at, 'string');
  assert.equal(newer.pending_resets, 0);
  assert.equal(newer.comment_count, 0);
});

test('ROK-1575 server: plans[] spans every slug and is sorted newest-first across slugs', async () => {
  const srv = await startServer();
  _servers.push(srv);

  await seedPlan(srv, 'rok1564a', '2026-09-15-1000-aaaa', {
    created_at: '2026-09-15T09:00:00.000Z', goal: 'older plan here', story_id: 'ROK-1563', steps: [step('s1')],
  });
  await seedPlan(srv, 'solo', '2026-09-15-1200-cccc', {
    created_at: '2026-09-15T12:00:00.000Z', goal: 'newest plan here', story_id: 'ROK-1570', steps: [step('s1')],
  });

  const j = await (await fetch(`${srv.base}/api/test-plans`)).json();
  assert.deepEqual(j.plans.map((p) => p.slug), ['solo', 'rok1564a']);
});

// -------------------------------------------------------------- frontend

/** Evaluate app.js inside jsdom at `url` and hand back the window. */
const loadApp = async (url = 'http://fleet.rl.lan/') => {
  const src = await readFile(APP_JS, 'utf-8');
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <span id="refresh-indicator"></span><div id="env-count"></div>
      <div id="generated-at"></div><div id="slots"></div><div id="envs"></div>
      <div id="tests"></div><span id="tests-count"></span>
      <div id="infra-section" style="display:none"></div>
    </body></html>`,
    { url, runScripts: 'outside-only', pretendToBeVisual: true },
  );
  dom.window.fetch = () => Promise.reject(new Error('fetch stubbed for jsdom test'));
  try {
    dom.window.eval(src);
  } catch (err) {
    if (!/fetch stubbed/.test(String(err))) throw err;
  }
  return dom.window;
};

test('ROK-1575 frontend: getTesterPlanFromUrl reads ?plan= and rejects junk', async () => {
  const good = await loadApp('http://fleet.rl.lan/?slug=rok1564a&plan=2026-09-15-1100-bbbb');
  assert.equal(typeof good.__rlTest?.getTesterPlanFromUrl, 'function',
    'app.js must expose getTesterPlanFromUrl via window.__rlTest');
  assert.equal(good.__rlTest.getTesterPlanFromUrl(), '2026-09-15-1100-bbbb');

  const bad = await loadApp('http://fleet.rl.lan/?slug=rok1564a&plan=../../etc/passwd');
  assert.equal(bad.__rlTest.getTesterPlanFromUrl(), null, 'a non plan-id-shaped value must be ignored');

  const none = await loadApp('http://fleet.rl.lan/?slug=rok1564a');
  assert.equal(none.__rlTest.getTesterPlanFromUrl(), null);
});

const planEntry = (over = {}) => ({
  slug: 'rok1564a',
  plan_id: '2026-09-15-1100-bbbb',
  story_id: 'ROK-1564',
  goal: 'Check the one-question game-time prompt',
  title: null,
  created_at: '2026-09-15T11:00:00.000Z',
  total: 3, pending: 3, pass: 0, fail: 0, skip: 0,
  pending_resets: 0, comment_count: 0,
  last_updated_at: '2026-09-15T11:00:00.000Z',
  ...over,
});

test('ROK-1575 frontend: renderTestPlanCard deep-links to its OWN plan', async () => {
  const window = await loadApp();
  const { renderTestPlanCard } = window.__rlTest;
  assert.equal(typeof renderTestPlanCard, 'function', 'renderTestPlanCard must be exposed');

  const card = renderTestPlanCard(planEntry());
  assert.equal(card.getAttribute('href'), '/?slug=rok1564a&plan=2026-09-15-1100-bbbb');
  assert.match(card.textContent, /ROK-1564/);
  assert.match(card.textContent, /Check the one-question game-time prompt/);
  assert.match(card.textContent, /3 of 3 need a verdict/);
  assert.match(card.querySelector('.test-card-meta').textContent, /rok1564a · 2026-09-15-1100-bbbb/);

  const done = renderTestPlanCard(planEntry({ pending: 0, pass: 3 }));
  assert.match(done.textContent, /✓ All 3 verdicted/);
});

test('ROK-1575 frontend: three plans across two slugs render three cards, one per plan', async () => {
  const window = await loadApp();
  const { renderTestSection } = window.__rlTest;
  assert.equal(typeof renderTestSection, 'function', 'renderTestSection must be exposed');

  const nodes = renderTestSection({
    plans: [
      planEntry({ plan_id: '2026-09-15-1200-cccc', slug: 'solo', story_id: 'ROK-1570', goal: 'newest solo plan' }),
      planEntry({ plan_id: '2026-09-15-1100-bbbb', story_id: 'ROK-1564', goal: 'the 1564 plan' }),
      planEntry({ plan_id: '2026-09-15-1000-aaaa', story_id: 'ROK-1563', goal: 'the 1563 plan' }),
    ],
  });
  const holder = window.document.createElement('div');
  nodes.forEach((n) => holder.appendChild(n));

  const cards = holder.querySelectorAll('a.test-card');
  assert.equal(cards.length, 3, 'one card per plan');
  assert.deepEqual([...cards].map((c) => c.getAttribute('href')), [
    '/?slug=solo&plan=2026-09-15-1200-cccc',
    '/?slug=rok1564a&plan=2026-09-15-1100-bbbb',
    '/?slug=rok1564a&plan=2026-09-15-1000-aaaa',
  ]);
  // The 1563 card must NOT be the one that opens the 1564 plan (the bug).
  const c1563 = [...cards].find((c) => c.textContent.includes('ROK-1563'));
  assert.equal(c1563.getAttribute('href'), '/?slug=rok1564a&plan=2026-09-15-1000-aaaa');

  // A slug holding several plans gets a grouping header; the single-plan
  // slug looks exactly as it did before.
  const headers = [...holder.querySelectorAll('.test-slug-header')].map((h) => h.textContent);
  assert.equal(headers.length, 1, 'only the multi-plan slug gets a header');
  assert.match(headers[0], /rok1564a · 2 plans/);
});

test('ROK-1575 frontend: falls back to per-slug cards when the server sends no plans[]', async () => {
  const window = await loadApp();
  const { renderTestSection } = window.__rlTest;
  const nodes = renderTestSection({
    test_plan_summaries: {
      rok1564a: { total: 4, pending: 2, plan_count: 2, story_id: 'ROK-1563', goal: 'legacy aggregate', last_updated_at: '2026-09-15T11:00:00.000Z' },
    },
  });
  const holder = window.document.createElement('div');
  nodes.forEach((n) => holder.appendChild(n));
  const cards = holder.querySelectorAll('a.test-card');
  assert.equal(cards.length, 1, 'older server → one legacy per-slug card, never a blank section');
  assert.equal(cards[0].getAttribute('href'), '/?slug=rok1564a');
});

test('ROK-1575 frontend: empty state survives both shapes', async () => {
  const window = await loadApp();
  const { renderTestSection } = window.__rlTest;
  for (const data of [{ plans: [] }, {}]) {
    const nodes = renderTestSection(data);
    assert.equal(nodes.length, 1);
    assert.match(nodes[0].textContent, /No active tests/);
  }
});
