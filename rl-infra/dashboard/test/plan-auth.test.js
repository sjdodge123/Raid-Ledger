// ROK-1847 — the public fleet dashboard must not accept anonymous test-plan
// writes. Spawns server.js against a tmp STATE_DIR (server.test.js pattern).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
  AGENT_TOKEN, PLAN_A, PLAN_B, makeStateDir, startServer, call, agentHeaders,
  planBody, seedPlanFile,
} from './auth-harness.js';

const cleanups = [];
test.after(async () => { for (const fn of cleanups.reverse()) await fn(); });

const boot = async (opts) => {
  const dir = await makeStateDir();
  const srv = await startServer(dir, opts);
  cleanups.push(async () => { await srv.kill(); await rm(dir, { recursive: true, force: true }); });
  return { dir, port: srv.port };
};

// Bodies travel base64-encoded inside a wrap tag on the agent path.
const BODY_B64 = Buffer.from('SECRET-COMMENT-BODY', 'utf8').toString('base64');
const hasBody = (text) => text.includes('SECRET-COMMENT-BODY') || text.includes(BODY_B64);

const PNG = `data:image/png;base64,${Buffer.from('fake-png-bytes').toString('base64')}`;
const testerRoutes = (planId) => [
  ['submit', `/api/test-plans/foo/${planId}/submit`, { tester: 'x', verdicts: [{ step_id: 1, verdict: 'pass' }] }],
  ['step result', `/api/test-plans/foo/${planId}/step/1/result`, { tester: 'x', verdict: 'pass' }],
  ['comment', `/api/test-plans/foo/${planId}/step/1/comment`, { tester: 'x', body: 'hello' }],
  ['reset', `/api/test-plans/foo/${planId}/step/1/reset-request`, { tester: 'x' }],
  ['attachment', `/api/test-plans/foo/${planId}/attachment`, { mime: 'image/png', data: PNG }],
];

test('AC1: plan PUT/POST is 401 with no token or a wrong one, 201 with the agent token', async () => {
  const { port } = await boot();
  const path = `/api/test-plans/foo/${PLAN_A}`;
  const none = await call(port, 'PUT', path, { body: planBody() });
  assert.equal(none.status, 401);
  const wrong = await call(port, 'POST', path, { body: planBody(), headers: { 'x-agent-token': 'nope' } });
  assert.equal(wrong.status, 401);
  const ok = await call(port, 'PUT', path, { body: planBody(), headers: agentHeaders });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(typeof ok.json.tester_token, 'string');
  assert.ok(ok.json.tester_token.length >= 32, 'tester token is long and random');
});

test('AC1: both DELETE routes are 401 without the agent token and succeed with it', async () => {
  const { dir, port } = await boot();
  await seedPlanFile(dir, PLAN_A);
  await seedPlanFile(dir, PLAN_B);
  assert.equal((await call(port, 'DELETE', `/api/test-plans/foo/${PLAN_A}`)).status, 401);
  assert.equal((await call(port, 'DELETE', '/api/test-plans/foo')).status, 401);
  const still = await call(port, 'GET', '/api/test-plans/foo');
  assert.equal(still.json.plans.length, 2, 'unauthenticated deletes removed nothing');
  assert.equal((await call(port, 'DELETE', `/api/test-plans/foo/${PLAN_A}`, { headers: agentHeaders })).status, 200);
  const slug = await call(port, 'DELETE', '/api/test-plans/foo', { headers: agentHeaders });
  assert.equal(slug.status, 200, slug.text);
});

test('AC1/AC3: with RL_AGENT_TOKEN unset, agent routes fail closed (503) and no comment bodies leak', async () => {
  const { dir, port } = await boot({ agentToken: null });
  await seedPlanFile(dir, PLAN_A);
  const put = await call(port, 'PUT', `/api/test-plans/foo/${PLAN_B}`, { body: planBody(), headers: { 'x-agent-token': '' } });
  assert.equal(put.status, 503);
  assert.equal((await call(port, 'DELETE', '/api/test-plans/foo')).status, 503);
  const get = await call(port, 'GET', `/api/test-plans/foo/${PLAN_A}?include_comments=1`);
  assert.equal(get.status, 200);
  assert.ok(!hasBody(get.text), 'comment body must not be returned');
});

test('AC3: include_comments returns bodies only for the matching agent token', async () => {
  const { dir, port } = await boot();
  await seedPlanFile(dir, PLAN_A);
  const path = `/api/test-plans/foo/${PLAN_A}?include_comments=1`;
  const wrong = await call(port, 'GET', path, { headers: { 'x-agent-token': `${AGENT_TOKEN}x` } });
  assert.ok(!hasBody(wrong.text));
  const right = await call(port, 'GET', path, { headers: agentHeaders });
  assert.ok(hasBody(right.text));
});

test('AC2: every tester write is 401 without a token, 2xx with the plan tester token or agent token', async () => {
  const { port } = await boot();
  const created = await call(port, 'PUT', `/api/test-plans/foo/${PLAN_A}`, { body: planBody(), headers: agentHeaders });
  const testerToken = created.json.tester_token;
  for (const [name, path, body] of testerRoutes(PLAN_A)) {
    const anon = await call(port, 'POST', path, { body });
    assert.equal(anon.status, 401, `${name} without token`);
    const bad = await call(port, 'POST', path, { body, headers: { 'x-tester-token': 'guess' } });
    assert.equal(bad.status, 401, `${name} with a wrong tester token`);
  }
  const before = await call(port, 'GET', `/api/test-plans/foo/${PLAN_A}`);
  assert.equal(before.json.summary.pass ?? 0, 0, 'no verdict landed from the anonymous calls');
  for (const [name, path, body] of testerRoutes(PLAN_A)) {
    const r = await call(port, 'POST', path, { body, headers: { 'x-tester-token': testerToken } });
    assert.ok(r.status >= 200 && r.status < 300, `${name} with tester token: ${r.status} ${r.text}`);
  }
  const viaAgent = await call(port, 'POST', `/api/test-plans/foo/${PLAN_A}/step/2/comment`,
    { body: { tester: 'agent', body: 'x' }, headers: agentHeaders });
  assert.equal(viaAgent.status, 200, viaAgent.text);
});

test('AC2: a tester token for one plan does not unlock another plan', async () => {
  const { port } = await boot();
  const a = await call(port, 'PUT', `/api/test-plans/foo/${PLAN_A}`, { body: planBody(), headers: agentHeaders });
  await call(port, 'PUT', `/api/test-plans/foo/${PLAN_B}`, { body: planBody(), headers: agentHeaders });
  const [, path, body] = testerRoutes(PLAN_B)[0];
  const r = await call(port, 'POST', path, { body, headers: { 'x-tester-token': a.json.tester_token } });
  assert.equal(r.status, 401);
});

test('AC2: a legacy plan with no tester token only accepts the agent token', async () => {
  const { dir, port } = await boot();
  await seedPlanFile(dir, PLAN_A);
  const [, path, body] = testerRoutes(PLAN_A)[0];
  assert.equal((await call(port, 'POST', path, { body, headers: { 'x-tester-token': '' } })).status, 401);
});

test('AC5: the LAN host fleet.rl.lan keeps tester writes working with no token', async () => {
  const { dir, port } = await boot();
  await seedPlanFile(dir, PLAN_A);
  const [, path, body] = testerRoutes(PLAN_A)[0];
  const lan = await call(port, 'POST', path, { body, headers: { host: 'fleet.rl.lan' } });
  assert.equal(lan.status, 200, lan.text);
  const spoof = await call(port, 'POST', path, {
    body, headers: { host: 'fleet.rl.lan', 'x-forwarded-host': 'fleet.gamernight.net' },
  });
  assert.equal(spoof.status, 401, 'a forwarded public host is not the LAN');
  const pub = await call(port, 'POST', path, { body, headers: { host: 'fleet.gamernight.net' } });
  assert.equal(pub.status, 401);
});

test('AC2: the tester token never appears in any read response', async () => {
  const { port } = await boot();
  const created = await call(port, 'PUT', `/api/test-plans/foo/${PLAN_A}`, { body: planBody(), headers: agentHeaders });
  const token = created.json.tester_token;
  assert.ok(!JSON.stringify(created.json.plan).includes(token), 'not inside the returned plan');
  const reads = ['/api/test-plans', '/api/test-plans/foo', `/api/test-plans/foo/${PLAN_A}`,
    `/api/test-plans/foo/${PLAN_A}?include_comments=1`, '/api/state'];
  for (const path of reads) {
    for (const headers of [{}, agentHeaders, { host: 'fleet.rl.lan' }]) {
      const r = await call(port, 'GET', path, { headers });
      assert.ok(!r.text.includes(token), `${path} leaked the tester token`);
    }
  }
  const submit = await call(port, 'POST', `/api/test-plans/foo/${PLAN_A}/submit`, {
    body: { tester: 'x', verdicts: [{ step_id: 1, verdict: 'pass' }] }, headers: { 'x-tester-token': token },
  });
  assert.ok(!submit.text.includes(token), 'submit response leaked the token');
});

test('AC4: test_url is limited to https://slot-N.<public domain> and *.rl.lan', async () => {
  const { port } = await boot();
  const put = (n, url) => call(port, 'PUT', `/api/test-plans/foo/2026-10-18-1200-00${n}0`, {
    body: planBody({ steps: [{ description: 'one', test_url: url }] }), headers: agentHeaders,
  });
  const rejected = ['https://evil.example.com/x', 'http://slot-1.gamernight.net/x',
    'https://slot-1.gamernight.net.evil.com/', 'https://slot-1.gamernight.net@evil.com/',
    'https://fooslot-1.gamernight.net/', 'https://gamernight.net/', 'javascript:alert(1)',
    'https://rl.lan.evil.com/'];
  let n = 1;
  for (const url of rejected) {
    const r = await put(n++, url);
    assert.equal(r.status, 400, `${url} should be rejected (${r.status})`);
  }
  const accepted = ['https://slot-3.gamernight.net/events/1', 'http://foo.rl.lan/x', 'https://slot-1.rl.lan/'];
  for (const url of accepted) {
    const r = await put(n++, url);
    assert.equal(r.status, 201, `${url} should be accepted: ${r.text}`);
    assert.equal(r.json.plan.steps[0].test_url, url);
  }
});
