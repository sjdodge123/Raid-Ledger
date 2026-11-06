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

// What GET /api/approvals/<id> returns for attachments: signed single-file
// URLs (approvals-sign.js). The page must use these and never build its own.
const SIGNED = {
  'mockup.html': `/approvals-content/${ID}/mockup.html?t=1762023000.SIGNEDmockupAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
  'shot-1.png': `/approvals-content/${ID}/shot-1.png?t=1762023000.SIGNEDshotAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
};
const signedUrls = (expMs = NOW + 10 * 60 * 1000) => ({ files: { ...SIGNED }, expires_at: new Date(expMs).toISOString() });

const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// Fake fetch. `post` decides each write's response (default: echo success).
const fakeFetch = ({ item = baseItem(), spec = XSS_SPEC, getStatus = 200, post, urls = () => signedUrls() } = {}) => {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body });
    if ((opts.method || 'GET') === 'GET') {
      if (getStatus !== 200) return okJson({ ok: false }, getStatus);
      return okJson({ ok: true, item, spec_md: spec, content_urls: urls() });
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
  for (const f of ['approvals-state.js', 'approvals-markdown.js', 'approvals-item-panels.js', 'approvals-item.js', 'approvals-list.js']) {
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

test('AC6: the mockup iframe is sandboxed with allow-scripts ONLY, no referrer, signed URL on the src', async () => {
  const { doc, calls } = await open();
  const frames = $$(doc, 'iframe');
  assert.equal(frames.length, 1);
  const f = frames[0];
  assert.equal(f.getAttribute('sandbox'), 'allow-scripts', `sandbox must be exactly allow-scripts, got "${f.getAttribute('sandbox')}"`);
  assert.equal(f.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(f.getAttribute('src'), SIGNED['mockup.html']);
  for (const attr of ['allow', 'allowfullscreen', 'srcdoc']) assert.equal(f.hasAttribute(attr), false, `iframe has ${attr}`);
  const full = $$(doc, 'a').find((a) => /Open full screen/.test(a.textContent));
  assert.equal(full.getAttribute('href'), f.getAttribute('src'));
  assert.equal(full.rel, 'noopener noreferrer');
  assert.equal(calls[0].url, `/api/approvals/${ID}`);
  assert.equal(calls[0].headers['X-Approval-Token'], KEY, 'item GET carries the inbox key header');
  assert.equal(doc.defaultView.__pwned, undefined, 'title markup stayed inert');
  assert.match(doc.querySelector('.approval-item-title').textContent, /<img src=x/);
});

test('width switcher gives the frame box a 390 / 820 / 1280 px WIDTH (Tablet and Desktop differ)', async () => {
  const { doc } = await open();
  const box = () => doc.querySelector('.approval-frame-box').style.width;
  assert.equal(doc.querySelector('.approval-frame-box').style.maxWidth, '', 'a max-width capped by the column made Tablet = Desktop');
  assert.ok(doc.querySelector('.approval-frame-viewport > .approval-frame-box > iframe'), 'frame sits in a scrolling viewport');
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
  assert.equal(img.getAttribute('src'), SIGNED['shot-1.png']);
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
  for (const f of ['app/approvals-item.js', 'app/approvals-item-panels.js', 'app/approvals-markdown.js']) {
    const code = (await read(f)).replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, f);
    assert.doesNotMatch(code, /allow-same-origin|allow-top-navigation|allow-popups/, `${f} widens the sandbox`);
  }
  const html = await read('index.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('/app/approvals-state.js') < at('/app/approvals-markdown.js')
    && at('/app/approvals-markdown.js') < at('/app/approvals-item-panels.js')
    && at('/app/approvals-item-panels.js') < at('/app/approvals-item.js')
    && at('/app/approvals-item.js') < at('/app/approvals-list.js'), 'state → markdown → item → list');
});

// BLOCKER regression (server review): the mockup can read its own URL, so no
// URL the page hands to the frame, a screenshot or "Open full screen" may
// carry a credential.
test('no credential in any frame / screenshot / full-screen URL', async () => {
  const { doc } = await open();
  const f = doc.querySelector('iframe');
  const img = doc.querySelector('.approval-shot img');
  const full = $$(doc, 'a').find((a) => /Open full screen/.test(a.textContent));
  for (const [what, u] of [['iframe src', f?.getAttribute('src')], ['screenshot src', img?.getAttribute('src')],
    ['full-screen href', full?.getAttribute('href')]]) {
    assert.equal(typeof u, 'string', `${what} rendered`);
    assert.ok(!/[?&]k=/.test(u), `${what} carries a ?k= param: ${u}`);
    assert.ok(!u.includes(KEY), `${what} contains the inbox key: ${u}`);
    assert.match(u, /\?t=/, `${what} is a signed URL: ${u}`);
  }
});

test('an attachment with no signed URL is not rendered (never falls back to a key URL)', async () => {
  const { doc } = await open({ urls: () => ({ files: {}, expires_at: null }) });
  assert.equal($$(doc, 'iframe').length, 0, 'no frame without a signed url');
  assert.equal($$(doc, '.approval-shot img').length, 0, 'no screenshot without a signed url');
});

test('a render near expiry re-fetches the item for fresh signed URLs, once', async () => {
  const fresh = `/approvals-content/${ID}/mockup.html?t=1762023600.FRESHmockupAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  let n = 0;
  const { doc, calls } = await open({
    urls: () => {
      n += 1;
      if (n === 1) return signedUrls(NOW + 60 * 1000);
      return { files: { ...SIGNED, 'mockup.html': fresh }, expires_at: new Date(NOW + 600000).toISOString() };
    },
  });
  const gets = () => calls.filter((c) => c.method === 'GET').length;
  assert.equal(gets(), 2, 'urls 60 s from expiry trigger one re-fetch');
  assert.equal(doc.querySelector('iframe').getAttribute('src'), fresh, 'the frame uses the fresh url');
  buttonByText(doc.querySelector('.approval-width-seg'), /^Phone$/).click();
  await settle();
  assert.equal(gets(), 2, 'fresh urls are not re-fetched on the next paint');
});

// ROK-1900 codex P2: responses can land out of order; an older one must not
// overwrite a newer ruling, and a late failure must not roll back others.
const gatedPost = (item) => {
  const gates = [];
  const post = (url, body) => new Promise((res) => { gates.push({ body, res }); });
  const answer = (i, ok = true) => {
    const g = must(gates[i], `post ${i}`);
    g.res(ok ? okJson({ ok: true, item: { ...item, rulings: [{ n: g.body.n, choice: g.body.choice, note: null, ts: `T${i}` }] } })
      : okJson({ ok: false, error: 'x' }, 500));
  };
  return { post, answer };
};
const must = (v, label) => { if (v === undefined || v === null) throw new Error(`missing ${label}`); return v; };

test('an older ruling response arriving last does not erase a newer ruling', async () => {
  const item = baseItem();
  const g = gatedPost(item);
  const { doc } = await open({ item, post: g.post });
  buttonByText(qCard(doc, 1), /^Accept$/).click();
  buttonByText(qCard(doc, 2), /Raid Ledger/).click();
  g.answer(1); // Q2 answers first (server snapshot: Q2 only)
  await settle();
  g.answer(0); // then Q1's older snapshot (Q1 only)
  await settle();
  assert.ok(qCard(doc, 1).classList.contains('ruled'), 'Q1 stays ruled');
  assert.ok(qCard(doc, 2).classList.contains('ruled'), 'Q2 must survive the older Q1 response');
  assert.match(doc.querySelector('.approval-sticky').textContent, /2 of 2 ruled/);
});

test('a late failure rolls back only its own ruling; a superseded response for the same question is ignored', async () => {
  const item = baseItem();
  const g = gatedPost(item);
  const { doc } = await open({ item, post: g.post });
  buttonByText(qCard(doc, 1), /^Accept$/).click(); // post 0
  buttonByText(qCard(doc, 2), /Raid Ledger/).click(); // post 1
  g.answer(1);
  await settle();
  g.answer(0, false);
  await settle();
  assert.ok(!qCard(doc, 1).classList.contains('ruled'), 'Q1 (refused) rolled back');
  assert.ok(qCard(doc, 2).classList.contains('ruled'), 'Q2 (saved) must not be rolled back by Q1 failing');
  buttonByText(qCard(doc, 2), /^Change$/).click();
  buttonByText(qCard(doc, 2), /LedgerLink/).click(); // post 2 supersedes Q2
  buttonByText(qCard(doc, 2), /^Change$/).click();
  buttonByText(qCard(doc, 2), /Raid Ledger/).click(); // post 3 supersedes post 2
  g.answer(3);
  await settle();
  g.answer(2); // stale: same question, older write
  await settle();
  assert.match(qCard(doc, 2).textContent, /Option a/, 'the newest choice for Q2 stays shown');
});

test('an idle page re-fetches the item ~1 min before its signed URLs expire', async () => {
  const fresh = `/approvals-content/${ID}/mockup.html?t=1762023600.FRESHmockupAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
  let n = 0;
  const f = fakeFetch({ urls: () => {
    n += 1;
    return n === 1 ? signedUrls(NOW + 10 * 60 * 1000)
      : { files: { ...SIGNED, 'mockup.html': fresh }, expires_at: new Date(NOW + 20 * 60 * 1000).toISOString() };
  } });
  const html = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, '');
  const w = new JSDOM(html, { url: `https://fleet.example.net/?approval=${ID}`, runScripts: 'outside-only' }).window;
  for (const file of ['approvals-state.js', 'approvals-markdown.js', 'approvals-item-panels.js', 'approvals-item.js']) w.eval(await read(`app/${file}`));
  const timers = [];
  const body = w.document.getElementById('approvals-body');
  await w.__rlApprovals.renderItemPage(body, ID, KEY, {
    fetch: f.fn, now: () => NOW, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
  });
  assert.equal(timers.length, 1, 'one refresh timer is armed');
  assert.equal(must(timers[0], 'timer').ms, 9 * 60 * 1000, 'fires 1 min before the 10 min expiry');
  must(timers[0], 'timer').fn();
  await settle();
  assert.equal(f.calls.filter((c) => c.method === 'GET').length, 2, 'the timer re-fetched the item');
  assert.equal(w.document.querySelector('iframe').getAttribute('src'), fresh);
  assert.equal(must(timers[1], 'next timer').ms, 19 * 60 * 1000, 're-armed for the fresh expiry');
});

test('round 4: an older saved ruling survives a newer failing one for the same question', async () => {
  const item = baseItem();
  const g = gatedPost(item);
  const { doc } = await open({ item, post: g.post });
  buttonByText(qCard(doc, 2), /Raid Ledger/).click(); // post 0: choice a
  buttonByText(qCard(doc, 2), /^Change$/).click();
  buttonByText(qCard(doc, 2), /LedgerLink/).click(); // post 1: choice b supersedes
  g.answer(0); // the server saved a
  await settle();
  g.answer(1, false); // b is refused
  await settle();
  assert.ok(qCard(doc, 2).classList.contains('ruled'), 'Q2 must stay ruled with the saved choice, not roll back to unruled');
  assert.match(qCard(doc, 2).textContent, /Option a/, 'rollback restores the server-confirmed ruling (a)');
  assert.ok(doc.querySelector('.approval-alert'), 'the refusal still shows an alert');
});

test('round 4: leaving item A disposes its URL timer — no repaint of A over the list or item B', async () => {
  const items = { 'item-A': baseItem({ id: 'item-A', title: 'Item A title' }), 'item-B': baseItem({ id: 'item-B', title: 'Item B title' }) };
  const gets = [];
  const fetchFn = async (url) => {
    const m = /\/api\/approvals\/([^/?]+)$/.exec(url);
    const it = m ? items[decodeURIComponent(m[1] || '')] : undefined;
    if (it) { gets.push(it.id); return okJson({ ok: true, item: it, spec_md: '', content_urls: signedUrls() }); }
    return okJson({ ok: true, items: [], plan_steps: [] });
  };
  const html = (await read('index.html')).replace(/<script[\s\S]*?<\/script>/g, '');
  const w = new JSDOM(html, { url: `https://fleet.example.net/?view=approvals&k=${KEY}`, runScripts: 'outside-only', pretendToBeVisual: true }).window;
  w.__rlApprovalsNoAutoBoot = true;
  w.scrollTo = () => {};
  for (const f of ['approvals-state.js', 'approvals-markdown.js', 'approvals-item-panels.js', 'approvals-item.js', 'approvals-list.js']) {
    w.eval(await read(`app/${f}`));
  }
  const NS = w.__rlApprovals;
  NS.bootApprovals({ fetchImpl: fetchFn, now: () => NOW, poll: false });
  await settle();
  const live = new Set();
  const fns = [];
  const opts = { fetch: fetchFn, now: () => NOW,
    setTimer: (fn) => { fns.push(fn); live.add(fns.length); return fns.length; }, clearTimer: (t) => { live.delete(t); } };
  const body = w.document.getElementById('approvals-body');
  await NS.renderItemPage(body, 'item-A', KEY, opts);
  assert.match(body.textContent, /Item A title/);
  const timerA = must(fns[0], 'item A timer');
  w.history.pushState(null, '', '/?view=approvals');
  w.dispatchEvent(new w.PopStateEvent('popstate'));
  await settle();
  assert.equal(live.size, 0, 'navigating to the list must clear item A\'s refresh timer');
  timerA();
  await settle();
  assert.doesNotMatch(body.textContent, /Item A title/, 'a stale timer from A must not repaint A over the list');
  await NS.renderItemPage(body, 'item-B', KEY, opts);
  timerA();
  await settle();
  assert.match(body.textContent, /Item B title/);
  assert.doesNotMatch(body.textContent, /Item A title/, 'a stale timer from A must not repaint A over item B');
  assert.equal(live.size, 1, 'only item B\'s timer is alive');
  assert.equal(gets.filter((x) => x === 'item-A').length, 1, 'item A is never re-fetched after leaving it');
});
