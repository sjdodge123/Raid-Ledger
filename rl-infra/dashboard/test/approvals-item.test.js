// ROK-1900 L5 — approvals item page (approvals-item.js) + safe markdown
// (approvals-markdown.js). JSDOM against the real index.html (scripts
// stripped), modules eval'd as the plain <script>s they are, fetch faked per
// route. ACs 2 + 3 (UI half: rulings, verdict, read-only decided state) and
// 6 (iframe attributes); markdown XSS stays inert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (p) => readFile(resolve(PUBLIC, p), 'utf-8');
const KEY = 'inbox-key-0123456789abcdef';
const ID = '2026-11-01-1630-3f9a';
const NOW = Date.parse('2026-11-01T18:30:00Z');

const XSS_SPEC = [
  '# Spec <b>title</b>',
  '<script>window.__pwned = 1</script>',
  '<img src=x onerror="window.__pwned = 2">',
  '- [bad](javascript:window.__pwned=3) and [plain](http://example.net/x)',
  '- [good](https://example.net/doc) with **bold** and *ital* and `code<i>`',
  '1. first',
  '```',
  '<script>alert(1)</script>',
  '```',
].join('\n');

const baseItem = (over = {}) => ({
  schema: 1, id: ID, story: 'ROK-2055', title: 'Dev bridge <img src=x onerror="window.__pwned=9">', kind: 'ruling',
  summary: 'An agent asks the companion…', created_at: '2026-11-01T14:30:00Z', asked_by: 'rok2055-spec',
  questions: [
    { n: 1, text: 'Where should the probe code live?', recommendation: 'A separate helper addon.' },
    { n: 2, text: 'Who owns the format?', recommendation: 'Raid Ledger.',
      options: [{ key: 'a', label: 'Raid Ledger' }, { key: 'b', label: 'LedgerLink repo' }] },
  ],
  attachments: { mockup: 'mockup.html', screenshots: [{ file: 'shot-1.png', caption: 'Phone, dark' }], spec: 'spec.md' },
  spec_path: 'planning-artifacts/specs/ROK-2055.md', links: [], supersedes: null,
  status: 'pending', rulings: [], verdict: null, decided_at: null, ...over,
});

const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// Fake fetch. `post` decides each write's response (default: echo success).
const fakeFetch = ({ item = baseItem(), spec = XSS_SPEC, getStatus = 200, post } = {}) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body });
    if ((opts.method || 'GET') === 'GET') {
      if (getStatus !== 200) return okJson({ ok: false }, getStatus);
      return okJson({ ok: true, item, spec_md: spec });
    }
    if (post) return post(url, body);
    if (url.endsWith('/ruling')) {
      return okJson({ ok: true, item: { ...item, rulings: [{ ...body, note: body.note ?? null, ts: 'T' }] } });
    }
    const status = { approve: 'approved', changes: 'changes_requested', reject: 'rejected' }[body.value];
    return okJson({ ok: true, item: { ...item, status, decided_at: '2026-11-01T18:31:00Z',
      verdict: { value: body.value, note: body.note ?? null, ts: 'T' } } });
  };
  return { fn, calls };
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i += 1) await flush(); };

const open = async (fetchOpts, url = `https://fleet.example.net/?approval=${ID}&k=${KEY}`) => {
  const html = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.__rlApprovalsNoAutoBoot = true;
  w.scrollTo = () => {};
  for (const f of ['approvals-state.js', 'approvals-markdown.js', 'approvals-item.js', 'approvals-list.js']) {
    w.eval(await read(`app/${f}`));
  }
  const f = fakeFetch(fetchOpts);
  w.__rlApprovals.bootApprovals({ fetchImpl: f.fn, now: () => NOW, poll: false });
  await settle();
  return { w, doc: w.document, ...f };
};
const $$ = (doc, sel) => [...doc.querySelectorAll(sel)];
const buttonByText = (root, re) => $$(root, 'button').find((b) => re.test(b.textContent));
const qCard = (doc, n) => doc.querySelector(`.approval-q[data-n="${n}"]`);

test('AC6: the mockup iframe is sandboxed with allow-scripts ONLY, no referrer, key on the src', async () => {
  const { doc, calls } = await open();
  const frames = $$(doc, 'iframe');
  assert.equal(frames.length, 1);
  const f = frames[0];
  assert.equal(f.getAttribute('sandbox'), 'allow-scripts', `sandbox must be exactly allow-scripts, got "${f.getAttribute('sandbox')}"`);
  assert.equal(f.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(f.getAttribute('src'), `/approvals-content/${ID}/mockup.html?k=${KEY}`);
  for (const attr of ['allow', 'allowfullscreen', 'srcdoc']) assert.equal(f.hasAttribute(attr), false, `iframe has ${attr}`);
  const full = $$(doc, 'a').find((a) => /Open full screen/.test(a.textContent));
  assert.equal(full.getAttribute('href'), f.getAttribute('src'));
  assert.equal(full.rel, 'noopener noreferrer');
  assert.equal(calls[0].url, `/api/approvals/${ID}`);
  assert.equal(calls[0].headers['X-Approval-Token'], KEY, 'item GET carries the inbox key header');
  assert.equal(doc.defaultView.__pwned, undefined, 'title markup stayed inert');
  assert.match(doc.querySelector('.approval-item-title').textContent, /<img src=x/);
});

test('width switcher sets the frame box to 390 / 820 / 1280 px', async () => {
  const { doc } = await open();
  const box = () => doc.querySelector('.approval-frame-box').style.maxWidth;
  assert.equal(box(), '1280px', 'desktop is the default');
  for (const [label, px] of [['Phone', '390px'], ['Tablet', '820px'], ['Desktop', '1280px']]) {
    buttonByText(doc.querySelector('.approval-width-seg'), new RegExp(`^${label}$`)).click();
    assert.equal(box(), px, `${label} width`);
    assert.equal(buttonByText(doc, new RegExp(`^${label}$`)).getAttribute('aria-pressed'), 'true');
  }
});

test('screenshots load through the content route; spec panel renders the safe markdown', async () => {
  const { doc } = await open();
  const img = doc.querySelector('.approval-shot img');
  assert.equal(img.getAttribute('src'), `/approvals-content/${ID}/shot-1.png?k=${KEY}`);
  assert.equal(img.alt, 'Phone, dark');
  img.parentElement.click();
  assert.ok(img.parentElement.classList.contains('zoomed'), 'tap zooms');
  assert.match(doc.querySelector('.approval-spec summary').textContent, /Spec — ROK-2055\.md/);
  const md = doc.querySelector('.approval-md');
  assert.ok(md.querySelector('h3'), '# heading → h3');
});

test('markdown XSS: <script>, <img onerror> and javascript: links render inert, as text', async () => {
  const { doc, w } = await open();
  const md = doc.querySelector('.approval-md');
  assert.equal(md.querySelectorAll('script, img, b, i, iframe').length, 0,
    `raw HTML became elements: ${md.innerHTML}`);
  assert.match(md.textContent, /<script>window.__pwned = 1<\/script>/);
  assert.match(md.textContent, /<img src=x onerror=/);
  const hrefs = $$(md, 'a').map((a) => a.getAttribute('href'));
  assert.deepEqual(hrefs, ['https://example.net/doc'], 'only the https link is a link');
  assert.equal($$(md, 'a')[0].rel, 'noopener noreferrer');
  assert.ok(md.textContent.includes('bad and plain'), 'unsafe link labels stay as text');
  assert.equal(w.__pwned, undefined);
  assert.equal(md.querySelector('strong').textContent, 'bold');
  assert.equal(md.querySelector('em').textContent, 'ital');
  assert.equal(md.querySelector('li code').textContent, 'code<i>');
  assert.equal(md.querySelector('ol li').textContent, 'first');
  assert.equal(md.querySelector('pre code').textContent, '<script>alert(1)</script>');
});

test('Accept rules optimistically and POSTs {n, choice} with the inbox key', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const item = baseItem();
  const { doc, calls } = await open({ item, post: async (url, body) => {
    await gate;
    return okJson({ ok: true, item: { ...item, rulings: [{ ...body, note: null, ts: 'T' }] } });
  } });
  buttonByText(qCard(doc, 1), /^Accept$/).click();
  assert.match(qCard(doc, 1).textContent, /Accepted recommendation/, 'shown before the server answers');
  assert.match(doc.querySelector('.approval-sticky').textContent, /1 of 2 ruled/);
  release();
  await settle();
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, `/api/approvals/${ID}/ruling`);
  assert.deepEqual(post.body, { n: 1, choice: 'accept' });
  assert.equal(post.headers['X-Approval-Token'], KEY);
  assert.ok(qCard(doc, 1).classList.contains('ruled'));
});

test('a refused ruling rolls back and shows an alert line', async () => {
  const { doc } = await open({ post: async () => okJson({ ok: false, error: 'x' }, 500) });
  buttonByText(qCard(doc, 1), /^Accept$/).click();
  await settle();
  assert.ok(!qCard(doc, 1).classList.contains('ruled'), 'rolled back to unruled');
  assert.ok(buttonByText(qCard(doc, 1), /^Accept$/), 'Accept is offered again');
  const alert = doc.querySelector('[role="alert"]');
  assert.match(alert?.textContent ?? '', /Not saved/);
});

test('Other… needs a note; option chips post the option key', async () => {
  const { doc, calls } = await open();
  buttonByText(qCard(doc, 1), /^Other…$/).click();
  const ta = qCard(doc, 1).querySelector('textarea');
  const save = buttonByText(qCard(doc, 1), /^Save$/);
  assert.equal(save.disabled, true, 'Save is disabled without a note');
  ta.value = 'Put it in LedgerLink';
  ta.dispatchEvent(new doc.defaultView.Event('input'));
  save.click();
  await settle();
  buttonByText(qCard(doc, 2), /^b · LedgerLink repo$/).click();
  await settle();
  const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
  assert.deepEqual(bodies, [{ n: 1, choice: 'other', note: 'Put it in LedgerLink' }, { n: 2, choice: 'b' }]);
});

test('verdict bar: Approve posts at once; Changes requested needs a note; decided page is read-only', async () => {
  const a = await open();
  buttonByText(a.doc.querySelector('.approval-sticky'), /^Approve$/).click();
  await settle();
  assert.deepEqual(a.calls.at(-1).body, { value: 'approve' });
  assert.equal(a.calls.at(-1).url, `/api/approvals/${ID}/verdict`);
  assert.equal(a.doc.querySelector('.approval-sticky'), null, 'no verdict bar once decided');
  assert.match(a.doc.querySelector('.approval-decided').textContent, /Approved/);

  const c = await open();
  buttonByText(c.doc.querySelector('.approval-sticky'), /^Changes requested$/).click();
  const send = buttonByText(c.doc.querySelector('.approval-sticky'), /^Send changes$/);
  assert.equal(send.disabled, true);
  const ta = c.doc.querySelector('.approval-sticky textarea');
  ta.value = 'Make the bar sticky';
  ta.dispatchEvent(new c.doc.defaultView.Event('input'));
  send.click();
  await settle();
  assert.deepEqual(c.calls.at(-1).body, { value: 'changes', note: 'Make the bar sticky' });
});

test('decided and withdrawn items render read-only with the ruling per question', async () => {
  const decided = baseItem({ status: 'approved', decided_at: '2026-10-30T12:00:00Z',
    rulings: [{ n: 1, choice: 'accept', has_note: false, ts: 'T' }, { n: 2, choice: 'other', has_note: true, ts: 'T' }],
    verdict: { value: 'approve', has_note: false, ts: 'T' } });
  const { doc } = await open({ item: decided });
  assert.equal(doc.querySelector('.approval-sticky'), null);
  assert.equal($$(doc, '.approval-questions button').length, 0, 'no ruling buttons on a decided item');
  assert.match(qCard(doc, 1).textContent, /Accepted recommendation/);
  assert.match(qCard(doc, 2).textContent, /Other · note on file/);
  assert.match(doc.querySelector('.approval-decided').textContent, /Approved · 30 Oct/);

  const wd = await open({ item: baseItem({ status: 'withdrawn', decided_at: '2026-10-30T12:00:00Z' }) });
  assert.match(wd.doc.querySelector('.approval-decided').textContent, /Withdrawn by the agent/);
  assert.equal($$(wd.doc, '.approval-questions button').length, 0);
});

test('error states: unknown item, refused key, no key on this device', async () => {
  const nf = await open({ getStatus: 404 });
  assert.match(nf.doc.getElementById('approvals-body').textContent, /does not exist/);
  const bad = await open({ getStatus: 401 });
  assert.match(bad.doc.getElementById('approvals-body').textContent, /key was refused/);
  const none = await open({}, `https://fleet.example.net/?approval=${ID}`);
  assert.match(none.doc.getElementById('approvals-body').textContent, /Open your approval link once/);
  assert.equal(none.calls.length, 0, 'no request without a key');
});

test('static: item + markdown modules never use innerHTML; scripts load before the list', async () => {
  for (const f of ['app/approvals-item.js', 'app/approvals-markdown.js']) {
    const code = (await read(f)).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, f);
    assert.doesNotMatch(code, /allow-same-origin|allow-top-navigation|allow-popups/, `${f} widens the sandbox`);
  }
  const html = await read('index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('/app/approvals-state.js') < at('/app/approvals-markdown.js')
    && at('/app/approvals-markdown.js') < at('/app/approvals-item.js')
    && at('/app/approvals-item.js') < at('/app/approvals-list.js'), 'state → markdown → item → list');
});
