// ROK-1900 L3 — unverdicted design/operator plan steps join the inbox list
// (spec D9, AC8): pure aggregation + the live GET /api/approvals join.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { PLAN_A, PLAN_B, call, makeStateDir, seedPlanFile, startServer } from './auth-harness.js';
import { collectPlanSteps, createPlanStepSource, isOperatorStep } from '../approvals-plan-steps.js';

const step = (id, category, results = []) => ({ id, description: `step ${id}`, category, results });
const plan = (plan_id, steps, extra = {}) => ({
  slug: 'foo', plan_id, story_id: 'ROK-1900', goal: 'rule the design', created_at: '2026-10-30T10:00:00Z',
  steps, ...extra,
});

test('isOperatorStep: design/operator in any case, unverdicted only', () => {
  assert.equal(isOperatorStep(step(1, 'design')), true);
  assert.equal(isOperatorStep(step(1, 'OPERATOR')), true);
  assert.equal(isOperatorStep(step(1, ' Design ')), true);
  assert.equal(isOperatorStep(step(1, 'smoke')), false);
  assert.equal(isOperatorStep(step(1, 'design-review')), false);
  assert.equal(isOperatorStep(step(1, null)), false);
  assert.equal(isOperatorStep(step(1, 'design', [{ verdict: 'pass' }])), false);
});

test('collectPlanSteps returns the PlanStepSummary shape with a token-less plan_url', () => {
  const out = collectPlanSteps([
    plan(PLAN_A, [step(1, 'smoke'), step(2, 'Design'), step(3, 'operator', [{ verdict: 'fail' }])],
      { tester_token: 'SECRET' }),
  ], { publicDomain: 'gamernight.net' });
  assert.deepEqual(out, [{
    slug: 'foo', plan_id: PLAN_A, story_id: 'ROK-1900', goal: 'rule the design', step_id: 2,
    description: 'step 2', category: 'design',
    plan_url: `https://fleet.gamernight.net/?slug=foo&plan=${PLAN_A}`,
  }]);
  assert.ok(!JSON.stringify(out).includes('SECRET'), 'no tester token leaks');
});

test('createPlanStepSource skips an unreadable slug instead of failing the list', async () => {
  const source = createPlanStepSource({
    listSlugs: async () => ['bad', 'foo'],
    listPlans: async (slug) => {
      if (slug === 'bad') throw new Error('EACCES');
      return [plan(PLAN_A, [step(1, 'operator')])];
    },
  });
  const out = await source();
  assert.equal(out.length, 1);
  assert.equal(out[0]?.plan_url, `http://fleet.rl.lan/?slug=foo&plan=${PLAN_A}`);
});

test('GET /api/approvals lists unverdicted design/operator steps; a verdict removes it', async () => {
  const INBOX = 'operator-inbox-key-plan-steps';
  const dir = await makeStateDir();
  const srv = await startServer(dir, { approvalToken: INBOX });
  const h = { 'x-approval-token': INBOX };
  try {
    await seedPlanFile(dir, PLAN_A, { steps: [step(1, 'design'), step(2, 'smoke')] });
    await seedPlanFile(dir, PLAN_B, { steps: [step(1, 'OPERATOR')] });
    const before = await call(srv.port, 'GET', '/api/approvals', { headers: h });
    assert.equal(before.status, 200, before.text);
    const keys = before.json.plan_steps.map((s) => `${s.plan_id}#${s.step_id}:${s.category}`).sort();
    assert.deepEqual(keys, [`${PLAN_A}#1:design`, `${PLAN_B}#1:operator`]);
    const r = await call(srv.port, 'POST', `/api/test-plans/foo/${PLAN_A}/step/1/result`,
      { body: { tester: 'op', verdict: 'pass' }, headers: h });
    assert.equal(r.status, 200, r.text);
    const after = await call(srv.port, 'GET', '/api/approvals', { headers: h });
    assert.deepEqual(after.json.plan_steps.map((s) => s.plan_id), [PLAN_B]);
  } finally {
    await srv.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
