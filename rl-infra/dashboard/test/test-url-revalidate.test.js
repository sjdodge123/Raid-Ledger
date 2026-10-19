// ROK-1847 Codex c1 — test_url is re-checked on read AND stored plans are
// rewritten once at startup, so a link planted before the create-time
// allow-list existed never reaches a tester.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizePlanTestUrls } from '../plan-auth.js';
import { PLAN_A, makeStateDir, startServer, call, agentHeaders, seedPlanFile } from './auth-harness.js';

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) await fn(); });

const EVIL = 'https://slot-1.gamernight.net.evil.com/login';
const GOOD = 'https://slot-1.gamernight.net/events/1';
const twoSteps = () => ({
  steps: [
    { id: 1, description: 'bad', test_url: EVIL, results: [], reset_requests: [], comments: [] },
    { id: 2, description: 'good', test_url: GOOD, results: [], reset_requests: [], comments: [] },
  ],
});

const boot = async (seed) => {
  const dir = await makeStateDir();
  if (seed) await seed(dir);
  const srv = await startServer(dir);
  cleanups.push(async () => { await srv.kill(); await rm(dir, { recursive: true, force: true }); });
  return { dir, port: srv.port, logs: srv.logs };
};

test('sanitizePlanTestUrls strips failing links, marks them, and reports each one', () => {
  const { plan, blocked } = sanitizePlanTestUrls({ plan_id: 'p', ...twoSteps() }, 'gamernight.net');
  assert.equal(plan.steps[0].test_url, null);
  assert.equal(plan.steps[0].test_url_blocked, true);
  assert.equal(plan.steps[1].test_url, GOOD);
  assert.equal(plan.steps[1].test_url_blocked, undefined);
  assert.deepEqual(blocked, [{ step_id: 1, host: 'slot-1.gamernight.net.evil.com' }]);
  const clean = sanitizePlanTestUrls({ steps: [{ id: 1, test_url: GOOD }] }, 'gamernight.net');
  assert.deepEqual(clean.blocked, []);
});

test('read path: a plan written after boot with a bad test_url is served with the link stripped', async () => {
  const { dir, port } = await boot();
  await seedPlanFile(dir, PLAN_A, twoSteps());
  for (const path of [`/api/test-plans/foo/${PLAN_A}`, '/api/test-plans/foo']) {
    const r = await call(port, 'GET', path);
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes('evil.com'), `${path} served the planted link`);
    assert.ok(r.text.includes(GOOD), `${path} dropped the valid link`);
    assert.ok(r.text.includes('"test_url_blocked":true'), `${path} lacks the blocked marker`);
  }
  const withBodies = await call(port, 'GET', `/api/test-plans/foo/${PLAN_A}?include_comments=1`, { headers: agentHeaders });
  assert.ok(!withBodies.text.includes('evil.com'), 'agent path served the planted link');
});

test('startup migration rewrites stored plans: bad link removed, marker set, audit line logged', async () => {
  const { dir, logs } = await boot((d) => seedPlanFile(d, PLAN_A, twoSteps()));
  const stored = JSON.parse(await readFile(join(dir, 'test-plans', 'foo', `${PLAN_A}.json`), 'utf-8'));
  assert.equal(stored.steps[0].test_url, null);
  assert.equal(stored.steps[0].test_url_blocked, true);
  assert.equal(stored.steps[1].test_url, GOOD);
  assert.equal(stored.steps[0].comments.length, 0, 'other fields untouched');
  const audit = logs().split('\n').find((l) => l.includes('"event":"test_url_blocked"'));
  assert.ok(audit, `no audit line in: ${logs()}`);
  assert.deepEqual(JSON.parse(audit), {
    event: 'test_url_blocked', slug: 'foo', plan_id: PLAN_A, step_id: 1, host: 'slot-1.gamernight.net.evil.com',
  });
});
