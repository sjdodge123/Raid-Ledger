// ROK-1900 L3 — /approvals-content/<id>/<file>: sandbox headers (D5, AC6),
// auth matrix (header or ?k=), traversal refusal, magic-byte content type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentHeaders, call, makeStateDir, startServer } from './auth-harness.js';
import { CONTENT_CSP, contentTypeFor } from '../approvals-content.js';

const INBOX_KEY = 'operator-inbox-key-for-rok-1900-l3';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const MOCKUP = '<!doctype html><title>m</title><script>document.title="ran"</script>';
const EXPECTED_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; "
  + "style-src 'unsafe-inline'; img-src data: blob: 'self'; font-src data:; connect-src 'none'; "
  + "form-action 'none'; frame-ancestors 'self'";

const cleanup = [];
test.after(async () => { for (const fn of cleanup.reverse()) await fn(); });

const boot = async (opts = { approvalToken: INBOX_KEY }) => {
  const dir = await makeStateDir();
  const srv = await startServer(dir, opts);
  cleanup.push(() => srv.kill(), () => rm(dir, { recursive: true, force: true }));
  return { dir, port: srv.port };
};

// Raw GET that keeps the response headers and bytes (`call` drops both).
const get = (port, path, headers = {}, method = 'GET') => new Promise((res, rej) => {
  const req = request({ host: '127.0.0.1', port, method, path, headers }, (r) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', rej);
  req.end();
});

const submitWithFiles = async (port) => {
  const r = await call(port, 'POST', '/api/approvals', {
    headers: agentHeaders,
    body: {
      story: 'ROK-1900', title: 'content test', kind: 'mockup', asked_by: 'rok1900-L3',
      questions: [{ text: 'Q?', recommendation: 'R' }],
      files: { mockup_html: MOCKUP, spec_md: '# spec', screenshots: [{ name: 'a.png', b64: PNG.toString('base64') }] },
    },
  });
  assert.equal(r.status, 201, `submit: ${r.text}`);
  return r.json.id;
};

test('the CSP constant is exactly the spec D5 policy', () => {
  assert.equal(CONTENT_CSP, EXPECTED_CSP);
});

test('mockup.html is served with the exact D5 sandbox CSP, no-referrer and nosniff', async () => {
  const { port } = await boot();
  const id = await submitWithFiles(port);
  const r = await get(port, `/approvals-content/${id}/mockup.html`, { 'x-approval-token': INBOX_KEY });
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-security-policy'], EXPECTED_CSP);
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(r.headers['cache-control'] ?? '', /no-store/);
  assert.equal(r.body.toString('utf8'), MOCKUP);
});

test('auth matrix: inbox header, ?k= inbox key and agent token read; nothing else does', async () => {
  const { port } = await boot();
  const id = await submitWithFiles(port);
  const path = `/approvals-content/${id}/mockup.html`;
  assert.equal((await get(port, path)).status, 401, 'no credential');
  assert.equal((await get(port, path, { 'x-approval-token': 'wrong' })).status, 401, 'wrong inbox key');
  assert.equal((await get(port, `${path}?k=wrong`)).status, 401, 'wrong ?k=');
  assert.equal((await get(port, `${path}?k=${agentHeaders['x-agent-token']}`)).status, 401,
    '?k= never accepts the agent token');
  assert.equal((await get(port, `${path}?k=${encodeURIComponent(INBOX_KEY)}`)).status, 200, '?k= inbox key');
  assert.equal((await get(port, path, agentHeaders)).status, 200, 'agent token header');
  assert.equal((await get(port, path, { 'x-approval-token': INBOX_KEY }, 'POST')).status, 405, 'POST');
});

test('fails closed (503) with RL_APPROVAL_TOKEN_SHA256 unset, even with ?k=', async () => {
  const { port } = await boot({});
  const r = await get(port, '/approvals-content/2026-01-01-0000-dead/mockup.html?k=anything', agentHeaders);
  assert.equal(r.status, 503);
});

test('traversal and unlisted names are refused before any file read', async () => {
  const { port } = await boot();
  const id = await submitWithFiles(port);
  const h = { 'x-approval-token': INBOX_KEY };
  for (const p of [
    `/approvals-content/${id}/..%2Fitem.json`,
    `/approvals-content/${id}/../item.json`,
    `/approvals-content/${id}/item.json`,
    `/approvals-content/${id}/files/mockup.html`,
    `/approvals-content/..%2F..%2Fclaims.json/mockup.html`,
    `/approvals-content/${id}/spec.md`,
    `/approvals-content/${id}/shot-9.png`,
    `/approvals-content/${id}/.mockup.html`,
  ]) {
    const r = await get(port, p, h);
    assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
    assert.ok(!r.body.toString('utf8').includes('"story"'), `${p} leaked item.json`);
  }
});

test('screenshots are typed from their magic bytes; a tampered file is refused (415)', async () => {
  const { dir, port } = await boot();
  const id = await submitWithFiles(port);
  const path = `/approvals-content/${id}/shot-1.png?k=${encodeURIComponent(INBOX_KEY)}`;
  const ok = await get(port, path);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal(ok.headers['content-security-policy'], EXPECTED_CSP);
  assert.ok(ok.body.equals(PNG));
  await writeFile(join(dir, 'approvals', id, 'files', 'shot-1.png'), '<script>alert(1)</script>xxxxxxxx');
  const bad = await get(port, path);
  assert.equal(bad.status, 415, `tampered png served as ${bad.headers['content-type']}`);
});

test('contentTypeFor: bytes must match the extension', () => {
  assert.equal(contentTypeFor('shot-1.png', PNG), 'image/png');
  assert.equal(contentTypeFor('shot-1.jpg', PNG), null, 'png bytes under a .jpg name');
  assert.equal(contentTypeFor('shot-1.png', Buffer.from('<html>not an image</html>')), null);
  assert.equal(contentTypeFor('mockup.html', Buffer.from('x')), 'text/html; charset=utf-8');
});
