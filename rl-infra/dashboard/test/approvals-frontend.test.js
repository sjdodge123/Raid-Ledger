// ROK-1900 L4 — approvals inbox list UI (approvals-state.js + approvals-list.js).
// JSDOM against the real index.html (scripts stripped), modules eval'd as the
// plain <script>s they are, fetch faked per route. AC 1 (list + plan steps)
// and AC 11 (archive is read-only list of decided items).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (p) => readFile(resolve(PUBLIC, p), 'utf-8');
const KEY = 'inbox-key-0123456789abcdef';
const NOW = Date.parse('2026-11-01T12:00:00Z');

const ITEMS = [
  { id: 'b-new', story: 'ROK-2055', title: 'Dev bridge', kind: 'ruling', asked_by: 'rok2055-spec',
    created_at: '2026-11-01T08:00:00Z', status: 'pending', question_count: 9, ruled_count: 3 },
  { id: 'a-old', story: 'ROK-1900', title: '<img src=x onerror="window.__pwned=1">', kind: 'mockup',
    asked_by: 'rok1900-spec', created_at: '2026-10-25T12:00:00Z', status: 'pending', question_count: 1, ruled_count: 0 },
];
const STEPS = [{ slug: 'rok2058a', plan_id: '2026-11-01-0910-ab12', story_id: 'ROK-2058', goal: 'Hub banner',
  step_id: 9, description: '<b>Banner</b> reads right', category: 'design',
  plan_url: 'https://fleet.example.net/?slug=rok2058a&plan=2026-11-01-0910-ab12' }];
const DECIDED = [{ id: 'c-dec', story: 'ROK-1960', title: 'Campaign binding', kind: 'ruling',
  created_at: '2026-10-28T12:00:00Z', decided_at: '2026-10-30T12:00:00Z', status: 'changes_requested',
  question_count: 5, ruled_count: 5 }];

const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

const fakeFetch = (overrides = {}) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (overrides.status) return okJson({ ok: false }, overrides.status);
    if (url.startsWith('/api/test-plans/')) return okJson({ ok: true });
    const decided = url.includes('status=decided');
    return okJson({ ok: true, items: decided ? DECIDED : ITEMS, plan_steps: STEPS, counts: { pending: 2, decided: 47 } });
  };
  return { fn, calls };
};

const load = async (url, { storage = true } = {}) => {
  const html = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  if (!storage) {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  }
  window.__rlApprovalsNoAutoBoot = true;
  window.scrollTo = () => {};
  window.eval(await read('app/approvals-state.js'));
  window.eval(await read('app/approvals-list.js'));
  return window;
};

const boot = async (window, fetchOverrides) => {
  const f = fakeFetch(fetchOverrides);
  const handle = window.__rlApprovals.bootApprovals({ fetchImpl: f.fn, now: () => NOW, poll: false });
  await handle.first;
  return { ...f, handle };
};
const text = (window, id) => window.document.getElementById(id).textContent;
const flush = () => new Promise((r) => setTimeout(r, 0));

test('parseKeyFromUrl reads ?k= and #k=, strips only k, rejects junk keys', async () => {
  const w = await load('https://fleet.example.net/');
  const parseKeyFromUrl = (u) => JSON.parse(JSON.stringify(w.__rlApprovals.parseKeyFromUrl(u)));
  assert.deepEqual(parseKeyFromUrl(`https://f.net/?view=approvals&k=${KEY}`), { key: KEY, cleanUrl: '/?view=approvals' });
  assert.deepEqual(parseKeyFromUrl(`https://f.net/?approval=x1#k=${KEY}`), { key: KEY, cleanUrl: '/?approval=x1' });
  assert.deepEqual(parseKeyFromUrl('https://f.net/?k=has%20space'), { key: null, cleanUrl: '/' });
  assert.deepEqual(parseKeyFromUrl('https://f.net/?view=approvals'), { key: null, cleanUrl: null });
});

test('key in the link is stored on the device and stripped from the URL; next visit reuses it', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  const { calls } = await boot(w);
  assert.equal(w.location.href, 'https://fleet.example.net/?view=approvals', 'k must be gone from the address bar');
  assert.equal(w.localStorage.getItem('rl-approval-key'), KEY);
  assert.equal(calls[0].opts.headers['X-Approval-Token'], KEY, 'key travels in the header');
  assert.ok(!calls[0].url.includes(KEY), 'key never goes in the API URL');
  // A later plain visit on the same origin finds the stored key.
  assert.equal(w.__rlApprovals.captureKey({ location: { href: 'https://fleet.example.net/' },
    history: w.history, localStorage: w.localStorage }), KEY);
});

test('blocked storage: URL key still works for this load and is still stripped', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals#k=${KEY}`, { storage: false });
  const { calls } = await boot(w);
  assert.equal(w.location.href, 'https://fleet.example.net/?view=approvals');
  assert.equal(calls[0].opts.headers['X-Approval-Token'], KEY);
});

test('no key on this device: one-time-link message, no fetch, no badge', async () => {
  const w = await load('https://fleet.example.net/?view=approvals');
  const { calls } = await boot(w);
  assert.equal(calls.length, 0);
  assert.match(text(w, 'approvals-body'), /Open your approval link once on this device/);
  assert.equal(w.document.getElementById('approvals-badge').hidden, true);
  assert.equal(w.document.getElementById('operator-main').hidden, true);
  assert.equal(w.document.getElementById('approvals-main').hidden, false);
});

test('pending list: oldest first, item links, plan-step cards, badge, seg counts — all text, no HTML', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  await boot(w);
  const doc = w.document;
  assert.match(doc.getElementById('approvals-main').querySelector('h3').textContent, /Waiting on you/);
  const cards = [...doc.querySelectorAll('a.approval-card')];
  assert.deepEqual(cards.map((a) => a.getAttribute('href')), ['/?approval=a-old', '/?approval=b-new']);
  assert.equal(cards[0].querySelector('.approval-title').textContent, ITEMS[1].title);
  assert.equal(doc.querySelectorAll('#approvals-body img, #approvals-body b').length, 0, 'server text must not parse as HTML');
  assert.equal(w.__pwned, undefined);
  assert.match(cards[1].textContent, /9 questions · 3 ruled/);
  assert.match(cards[1].textContent, /rok2055-spec · 4 h/);
  assert.equal(cards[1].querySelector('.approval-prog i').style.width, '33%');
  const step = doc.querySelector('.approval-step-card');
  assert.match(step.textContent, /ROK-2058.*design step 9/);
  assert.equal(step.querySelector('.approval-title').textContent, STEPS[0].description);
  assert.equal(step.querySelector('a').getAttribute('href'), STEPS[0].plan_url);
  assert.equal(text(w, 'approvals-badge'), '3', 'badge = 2 pending items + 1 plan step');
  assert.equal(text(w, 'approvals-seg-pending'), 'Pending · 2');
  assert.equal(text(w, 'approvals-seg-archive'), 'Archive · 47');
  assert.ok(doc.getElementById('tab-approvals').classList.contains('on'));
});

test('archive tab fetches decided items and shows the status pill, read-only', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  const { calls } = await boot(w);
  w.document.getElementById('approvals-seg-archive').click();
  await flush();
  assert.match(calls.at(-1).url, /status=decided$/);
  const card = w.document.querySelector('a.approval-card');
  assert.equal(card.getAttribute('href'), '/?approval=c-dec');
  assert.equal(card.querySelector('.approval-pill.chg').textContent, 'changes requested');
  assert.match(card.textContent, /decided 30 Oct/);
  assert.equal(w.document.querySelectorAll('#approvals-body .approval-btn-pass').length, 0, 'archive has no action buttons');
});

test('plan-step Pass posts the verdict to the plan with the inbox key', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  const { calls } = await boot(w);
  w.document.querySelector('.approval-btn-pass').click();
  await flush();
  const post = calls.find((c) => c.opts.method === 'POST');
  assert.ok(post, 'a POST was sent');
  assert.equal(post.url, '/api/test-plans/rok2058a/2026-11-01-0910-ab12/submit');
  assert.equal(post.opts.headers['X-Approval-Token'], KEY);
  assert.deepEqual(JSON.parse(post.opts.body), { tester: 'operator', verdicts: [{ step_id: 9, verdict: 'pass' }] });
});

test('503 = inbox not switched on; 401 = key refused with a Forget link that clears storage', async () => {
  const w1 = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  await boot(w1, { status: 503 });
  assert.match(text(w1, 'approvals-body'), /not switched on/);
  const w2 = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  await boot(w2, { status: 401 });
  assert.match(text(w2, 'approvals-body'), /key was refused/);
  w2.document.querySelector('.approval-forget').click();
  await flush();
  assert.equal(w2.localStorage.getItem('rl-approval-key'), null);
  assert.match(text(w2, 'approvals-body'), /Open your approval link once/);
});

test('item route shows the approvals main with a placeholder until L5 registers renderItemPage', async () => {
  const w = await load(`https://fleet.example.net/?approval=a-old&k=${KEY}`);
  const { calls } = await boot(w);
  assert.equal(w.location.href, 'https://fleet.example.net/?approval=a-old');
  assert.equal(w.document.getElementById('approvals-main').hidden, false);
  assert.match(text(w, 'approvals-body'), /Opening item a-old/);
  assert.equal(calls.length, 0);
});

test('Fleet tab swaps back in place; fleet view still polls the badge', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  const { calls } = await boot(w);
  w.document.getElementById('tab-fleet').click();
  await flush();
  assert.equal(w.location.pathname + w.location.search, '/');
  assert.equal(w.document.getElementById('operator-main').hidden, false);
  assert.equal(w.document.getElementById('approvals-main').hidden, true);
  assert.match(calls.at(-1).url, /status=pending$/);
  assert.equal(text(w, 'approvals-badge'), '3');
});

test('static wiring: script order, mount points, ROK-1900 CSS block with 44px targets', async () => {
  const html = await read('index.html');
  const iState = html.indexOf('/app/approvals-state.js');
  const iList = html.indexOf('/app/approvals-list.js');
  const iApp = html.indexOf('/app.js"');
  assert.ok(iState > 0 && iState < iList && iList < iApp, 'state before list before app.js');
  for (const id of ['tab-fleet', 'tab-approvals', 'approvals-badge', 'approvals-main', 'approvals-body', 'approvals-seg']) {
    assert.ok(html.includes(`id="${id}"`), `${id} mount exists`);
  }
  const css = await read('style.css');
  const block = css.slice(css.indexOf('/* ROK-1900'));
  assert.ok(block.length > 100, 'ROK-1900 CSS block present');
  for (const sel of ['.view-tab {', '.approvals-seg button {', '.approval-btn {', '.approval-forget {']) {
    const rule = block.slice(block.indexOf(sel), block.indexOf('}', block.indexOf(sel)));
    assert.match(rule, /min-height: 44px/, `${sel} is a 44px target`);
  }
  const code = (await read('app/approvals-list.js')).replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML/);
});

test('a plan step blocked by an earlier unverdicted step offers no Pass/Fail and says which step', async () => {
  const w = await load(`https://fleet.example.net/?view=approvals&k=${KEY}`);
  const blocked = [{ ...STEPS[0], blocked_by: 3 }];
  const calls = [];
  w.__rlApprovals.bootApprovals({
    fetchImpl: async (url, opts = {}) => {
      calls.push({ url, opts });
      return okJson({ ok: true, items: ITEMS, plan_steps: blocked, counts: { pending: 2, decided: 0 } });
    },
    now: () => NOW, poll: false,
  });
  await flush();
  await flush();
  const card = w.document.querySelector('.approval-step-card');
  assert.ok(card, 'the step card renders');
  assert.equal(card.querySelectorAll('.approval-btn-pass, .approval-btn-fail').length, 0, 'no verdict buttons on a blocked step');
  assert.match(card.querySelector('.approval-step-blocked')?.textContent ?? '', /Waiting on step 3/);
  assert.ok(card.querySelector('a.approval-btn'), 'Open ↗ is still offered');
  assert.equal(calls.filter((c) => c.opts.method === 'POST').length, 0);
});
