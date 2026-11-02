// ROK-1900 fix A — the inbox key never rides in a URL (server review BLOCKER):
// signed single-file content URLs, ?k= refused, main-page CSP, and the abuse
// limits (413 abort, submit concurrency, read rate, auth-failure lockout).
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rm } from 'node:fs/promises';
import { agentHeaders, call, makeStateDir, startServer } from './auth-harness.js';
import { createContentSigner } from '../approvals-sign.js';

const INBOX_KEY = 'operator-inbox-key-for-rok-1900-fixA';
const INBOX = { 'x-approval-token': INBOX_KEY };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const ID_A = '2026-11-01-1200-aaaa';
const ID_B = '2026-11-01-1200-bbbb';

const cleanup = [];
test.after(async () => { for (const fn of cleanup.reverse()) await fn(); });

const boot = async (env = {}) => {
  const dir = await makeStateDir();
  const srv = await startServer(dir, { approvalToken: INBOX_KEY, env });
  cleanup.push(() => srv.kill(), () => rm(dir, { recursive: true, force: true }));
  return srv.port;
};

const raw = (port, method, path, headers = {}) => new Promise((res, rej) => {
  const req = request({ host: '127.0.0.1', port, method, path, headers }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', rej);
  req.end();
});

const submit = (port) => call(port, 'POST', '/api/approvals', {
  headers: agentHeaders,
  body: {
    story: 'ROK-1900', title: 'signed url test', kind: 'mockup', asked_by: 'rok1900-fixA',
    questions: [{ text: 'Q?', recommendation: 'R' }],
    files: { mockup_html: '<p>m</p>', screenshots: [{ name: 'a.png', b64: PNG.toString('base64') }] },
  },
}).then((r) => { assert.equal(r.status, 201, `submit: ${r.text}`); return r.json.id; });

const signedFor = async (port, id) => {
  const r = await call(port, 'GET', `/api/approvals/${id}`, { headers: INBOX });
  assert.equal(r.status, 200);
  return r.json.content_urls;
};

test('signer: valid only for its own id + file, until exp; tamper/expiry/other file/other item refused', () => {
  let t = Date.parse('2026-11-01T12:00:00Z');
  const s = createContentSigner({ now: () => t });
  const tok = new URL(s.sign(ID_A, 'mockup.html').url, 'http://x').searchParams.get('t');
  assert.equal(s.verify(ID_A, 'mockup.html', tok), true, 'own file');
  assert.equal(s.verify(ID_A, 'shot-1.png', tok), false, 'other file of the same item');
  assert.equal(s.verify(ID_B, 'mockup.html', tok), false, 'same file name on another item');
  const [exp, sig] = tok.split('.');
  assert.equal(s.verify(ID_A, 'mockup.html', `${Number(exp) + 3600}.${sig}`), false, 'exp pushed out');
  const flipped = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
  assert.equal(s.verify(ID_A, 'mockup.html', `${exp}.${flipped}`), false, 'signature tampered');
  assert.equal(s.verify(ID_A, 'mockup.html', 'garbage'), false, 'malformed');
  assert.equal(createContentSigner({ now: () => t }).verify(ID_A, 'mockup.html', tok), false, 'other boot secret');
  t += 10 * 60 * 1000;
  assert.equal(s.verify(ID_A, 'mockup.html', tok), false, 'expired after 10 minutes');
});

test('GET item mints signed URLs that carry no credential and serve only their own file', async () => {
  const port = await boot();
  const id = await submit(port);
  const other = await submit(port);
  const cu = await signedFor(port, id);
  const mockup = cu.files['mockup.html'];
  const shot = cu.files['shot-1.png'];
  for (const u of [mockup, shot]) {
    assert.match(u, /\?t=\d+\.[A-Za-z0-9_-]{43}$/, `signed url shape: ${u}`);
    assert.ok(!u.includes(INBOX_KEY) && !/[?&]k=/.test(u), `credential in url: ${u}`);
  }
  assert.ok(Date.parse(cu.expires_at) - Date.now() <= 10 * 60 * 1000 + 1000, 'expires within ~10 minutes');
  assert.equal((await raw(port, 'GET', mockup)).status, 200, 'own file, no header');
  assert.equal((await raw(port, 'GET', shot)).status, 200, 'own screenshot, no header');
  const t = mockup.split('?t=')[1];
  assert.equal((await raw(port, 'GET', `/approvals-content/${id}/shot-1.png?t=${t}`)).status, 403, 'other file');
  assert.equal((await raw(port, 'GET', `/approvals-content/${other}/mockup.html?t=${t}`)).status, 403, 'other item');
  const tampered = `${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`;
  assert.equal((await raw(port, 'GET', `/approvals-content/${id}/mockup.html?t=${tampered}`)).status, 403, 'tampered');
  assert.equal((await raw(port, 'POST', mockup)).status, 405, 'read-only');
});

test('?k= is refused on content even with the real inbox key (401)', async () => {
  const port = await boot();
  const id = await submit(port);
  const r = await raw(port, 'GET', `/approvals-content/${id}/mockup.html?k=${encodeURIComponent(INBOX_KEY)}`);
  assert.equal(r.status, 401, `?k= inbox key must not authorise content, got ${r.status}`);
  const a = await raw(port, 'GET', `/approvals-content/${id}/mockup.html?k=${agentHeaders['x-agent-token']}`);
  assert.equal(a.status, 401, 'agent token via query refused');
});

test('dashboard HTML is served with the page CSP', async () => {
  const port = await boot();
  for (const p of ['/', '/index.html']) {
    const csp = (await raw(port, 'GET', p)).headers['content-security-policy'] ?? '';
    for (const d of ["frame-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'", "script-src 'self'"]) {
      assert.ok(csp.split('; ').includes(d), `${p} CSP lacks ${d}: "${csp}"`);
    }
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), `${p} allows inline script: "${csp}"`);
  }
});

test('an oversized body is answered 413 and the socket is destroyed mid-upload', async () => {
  const port = await boot();
  const result = await new Promise((resolve, reject) => {
    const out = { status: null, closed: false };
    const req = request({
      host: '127.0.0.1', port, method: 'POST', path: `/api/approvals/${ID_A}/ruling`,
      headers: { ...INBOX, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    }, (r) => { out.status = r.statusCode; r.resume(); });
    req.on('error', () => {});
    req.on('close', () => { out.closed = true; resolve(out); });
    req.write(`{"n":1,"note":"${'x'.repeat(64 * 1024)}`); // never ended by the client
    setTimeout(() => reject(new Error(`socket still open; status=${out.status}`)), 3000).unref();
  });
  assert.equal(result.status, 413);
  assert.equal(result.closed, true, 'server closed the connection without the client ending the body');
});

test('more than 2 submits in flight → 429 too_many_submits', async () => {
  const port = await boot();
  const held = [0, 1].map(() => {
    const req = request({
      host: '127.0.0.1', port, method: 'POST', path: '/api/approvals',
      headers: { ...agentHeaders, 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
    });
    req.on('error', () => {});
    req.write('{"story":"ROK-1900",');
    return req;
  });
  // Poll until both held submits have reached the handler (no fixed sleep):
  // before then a third is admitted and fails validation (400), harmlessly.
  let third;
  for (let i = 0; i < 50; i += 1) {
    third = await call(port, 'POST', '/api/approvals', { headers: agentHeaders, body: { story: 'ROK-1900' } });
    if (third.status === 429) break;
  }
  for (const r of held) r.destroy();
  assert.equal(third.status, 429, `third concurrent submit: ${third.text}`);
  assert.equal(third.json?.error, 'too_many_submits');
});

test('failed approval auth is counted per IP; past the cap even a valid key gets 429', async () => {
  const port = await boot({ RL_APPROVAL_AUTH_FAIL_MAX: '3' });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call(port, 'GET', '/api/approvals', { headers: { 'x-approval-token': `guess-${i}` } })).status, 401);
  }
  const locked = await call(port, 'GET', '/api/approvals', { headers: INBOX });
  assert.equal(locked.status, 429, `after 3 failures: ${locked.text}`);
  assert.equal(locked.json?.error, 'too_many_auth_failures');
  const content = await raw(port, 'GET', `/approvals-content/${ID_A}/mockup.html`, INBOX);
  assert.equal(content.status, 429, 'content route shares the lockout');
});

test('approval GETs are rate-limited per IP', async () => {
  const port = await boot({ RL_APPROVAL_READ_MAX: '3' });
  for (let i = 0; i < 3; i += 1) assert.equal((await call(port, 'GET', '/api/approvals', { headers: INBOX })).status, 200);
  const r = await call(port, 'GET', '/api/approvals', { headers: INBOX });
  assert.equal(r.status, 429);
  assert.equal(r.json?.error, 'rate_limit_exceeded');
});
