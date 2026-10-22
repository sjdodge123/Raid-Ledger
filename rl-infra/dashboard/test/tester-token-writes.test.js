// ROK-1847 follow-up — the tester page's writes (submit, comment) carry the
// plan's tester token from the shared `?k=` link, even after the query string
// is gone (the tester navigated, or reloaded from a token-less card link), and
// a missing token surfaces a message that tells the tester what to do.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES = ['test-plan-state.js', 'test-plan-render.js', 'test-plan-submit.js', 'test-plan-polling.js']
  .map((f) => resolve(__dirname, '..', 'public', 'app', f));

const SLUG = 'rok1847';
const PLAN = '2026-10-22-1000-aaaa';
const OTHER_PLAN = '2026-10-22-1100-bbbb';
const KEY = 'tok_ABCDEFGHIJKLMNOPQRSTUVWX';

/** Load the tester modules into jsdom at `url`; every fetch is recorded. */
const loadTester = async (url, respond = () => ({ status: 200, body: { ok: true, plans: [] } })) => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const calls = [];
  window.fetch = async (path, init = {}) => {
    calls.push({ path: String(path), method: init.method || 'GET', headers: init.headers || {} });
    const { status, body } = respond(String(path), init);
    return { ok: status < 400, status, json: async () => body };
  };
  window.localStorage.setItem('rl-tester-name-v2', 'Jake');
  for (const file of MODULES) window.eval(await readFile(file, 'utf-8'));
  return { window, NS: window.__rlTester, calls };
};

const writes = (calls) => calls.filter((c) => c.method === 'POST');

test('submit and comment send the ?k= token for the linked plan, even after the URL drops it', async () => {
  const { window, NS, calls } = await loadTester(`http://fleet.example/?slug=${SLUG}&plan=${PLAN}&k=${KEY}`);
  await NS.bootTesterPage(SLUG, PLAN);
  // The tester lands back on the plan from the token-less dashboard card.
  window.history.replaceState(null, '', `/?slug=${SLUG}&plan=${PLAN}`);

  NS.bufferVerdict(SLUG, PLAN, 1, 'pass');
  assert.equal((await NS.submitDraft(SLUG, { plan_id: PLAN })).ok, true);
  assert.equal((await NS.postComment(SLUG, { plan_id: PLAN }, 1, 'looks fine', null)).ok, true);

  const [submit, comment] = writes(calls);
  assert.equal(submit.path, `/api/test-plans/${SLUG}/${PLAN}/submit`);
  assert.equal(submit.headers['x-tester-token'], KEY);
  assert.equal(comment.path, `/api/test-plans/${SLUG}/${PLAN}/step/1/comment`);
  assert.equal(comment.headers['x-tester-token'], KEY);
});

test('a write for a different plan on the same page does not borrow the linked plan\'s token', async () => {
  const { NS, calls } = await loadTester(`http://fleet.example/?slug=${SLUG}&plan=${PLAN}&k=${KEY}`);
  await NS.bootTesterPage(SLUG, PLAN);
  await NS.postComment(SLUG, { plan_id: OTHER_PLAN }, 2, 'other plan', null);
  const [comment] = writes(calls);
  assert.equal(comment.path, `/api/test-plans/${SLUG}/${OTHER_PLAN}/step/2/comment`);
  assert.equal(comment.headers['x-tester-token'], undefined);
});

test('tester_token_required becomes a message that points the tester at their link', async () => {
  const denied = (path, init) => (init.method === 'POST'
    ? { status: 401, body: { ok: false, error: 'tester_token_required' } }
    : { status: 200, body: { ok: true, plans: [] } });
  const { NS } = await loadTester(`http://fleet.example/?slug=${SLUG}&plan=${PLAN}`, denied);
  NS.bufferVerdict(SLUG, PLAN, 1, 'pass');
  const expected = /opened without its tester link — open the link you were sent \(it ends in &k=…\)/;
  assert.match((await NS.submitDraft(SLUG, { plan_id: PLAN })).error, expected);
  assert.match((await NS.postComment(SLUG, { plan_id: PLAN }, 1, 'x', null)).error, expected);
  assert.match((await NS.requestReset(SLUG, { plan_id: PLAN }, 1)).error, expected);
});
