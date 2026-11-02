// ROK-1900 L2 — approvals JSON routes + inbox-key auth, against a spawned
// server (auth-harness). ACs 4, 5, 7 (server half), 10 (server half), 11, 14.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_TOKEN, agentHeaders, call, makeStateDir, startServer } from './auth-harness.js';
import { createApprovalAuth, inboxKeyMatches, parseInboxHash } from '../approvals-auth.js';

const INBOX_KEY = 'operator-inbox-key-for-rok-1900-tests';
const inbox = { 'x-approval-token': INBOX_KEY };
const wrongKey = { 'x-approval-token': 'not-the-inbox-key' };
const ID_FMT = /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/;
const UNKNOWN_ID = '2026-01-01-0000-dead';

const q = (i) => ({ text: `Question ${i}?`, recommendation: `Rec ${i}` });
const itemBody = (over = {}) => ({
  story: 'ROK-1900', title: 'Pending-approval inbox', kind: 'mockup',
  summary: 'context', asked_by: 'rok1900-L2', questions: [q(1), q(2), q(3)], ...over,
});

const cleanup = [];
test.after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

const boot = async (opts) => {
  const dir = await makeStateDir();
  const srv = await startServer(dir, opts);
  cleanup.push(() => srv.kill(), () => rm(dir, { recursive: true, force: true }));
  return { dir, srv, port: srv.port };
};

const submit = async (port, over) => {
  const r = await call(port, 'POST', '/api/approvals', { body: itemBody(over), headers: agentHeaders });
  assert.equal(r.status, 201, `submit: ${r.text}`);
  return r.json.id;
};

// Raw request for the cases `call` cannot express (content-type, oversize).
const raw = (port, method, path, { headers = {}, body = '' } = {}) => new Promise((res, rej) => {
  const req = request({ host: '127.0.0.1', port, method, path,
    headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (r) => {
    let text = '';
    r.on('data', (c) => { text += c; });
    r.on('end', () => res({ status: r.statusCode, text }));
  });
  req.on('error', rej);
  req.end(body);
});

const routesFor = (id) => [
  ['GET', '/api/approvals', undefined],
  ['POST', '/api/approvals', itemBody()],
  ['GET', `/api/approvals/${id}`, undefined],
  ['POST', `/api/approvals/${id}/ruling`, { n: 1, choice: 'accept' }],
  ['POST', `/api/approvals/${id}/verdict`, { value: 'approve' }],
  ['POST', `/api/approvals/${id}/withdraw`, {}],
];

test('auth module: digest compare, fail closed on unset or malformed hash', () => {
  const hex = createHash('sha256').update('k1').digest('hex');
  assert.equal(parseInboxHash(undefined), null);
  assert.equal(parseInboxHash(''), null);
  assert.equal(parseInboxHash('abc123'), null, 'short hex is malformed');
  assert.equal(parseInboxHash('k1'), null, 'a raw key in the env is not a hash');
  assert.ok(parseInboxHash(hex.toUpperCase()), 'uppercase hex accepted');
  assert.equal(inboxKeyMatches('k1', parseInboxHash(hex)), true);
  assert.equal(inboxKeyMatches('k2', parseInboxHash(hex)), false);
  assert.equal(inboxKeyMatches('', parseInboxHash(hex)), false);
  assert.equal(inboxKeyMatches('k1', null), false);
  assert.equal(inboxKeyMatches(hex, parseInboxHash(hex)), false, 'the hash itself is not the key');
  const auth = createApprovalAuth({ agentToken: 'a', inboxHashHex: undefined });
  assert.equal(auth.configured, false);
  assert.deepEqual(auth.deny({ headers: { 'x-agent-token': 'a' } }, 'read'),
    { status: 503, error: 'approval_token_unconfigured' });
  assert.equal(auth.keyOk('k1'), false);
});

for (const [label, opts] of [
  ['unset', { approvalToken: null }],
  ['malformed', { env: { RL_APPROVAL_TOKEN_SHA256: 'not-a-sha256' } }],
]) {
  test(`RL_APPROVAL_TOKEN_SHA256 ${label} → 503 on every approval route, even with the agent token`, async () => {
    const { port } = await boot(opts);
    for (const [method, path, body] of routesFor(UNKNOWN_ID)) {
      for (const headers of [agentHeaders, inbox]) {
        const r = await call(port, method, path, { body, headers });
        assert.equal(r.status, 503, `${method} ${path}: ${r.text}`);
        assert.equal(r.json?.error, 'approval_token_unconfigured');
      }
    }
  });
}

test('RL_AGENT_TOKEN unset → agent-only routes 503, inbox reads still work', async () => {
  const { port } = await boot({ agentToken: null, approvalToken: INBOX_KEY });
  const r = await call(port, 'POST', '/api/approvals', { body: itemBody(), headers: { 'x-agent-token': AGENT_TOKEN } });
  assert.equal(r.status, 503);
  assert.equal(r.json?.error, 'agent_token_unconfigured');
  assert.equal((await call(port, 'GET', '/api/approvals', { headers: inbox })).status, 200);
});

test('approvals API — auth matrix, routes, redaction, persistence', async (t) => {
  const { dir, port: port0 } = await boot({ approvalToken: INBOX_KEY });
  let port = port0;
  // The dispatcher allows 30 writes/min per IP (rateLimitOk, in-process), so
  // write-heavy subtests restart the server on the same state dir first —
  // which doubles as proof that items persist across restarts.
  const fresh = async () => {
    const s2 = await startServer(dir, { approvalToken: INBOX_KEY });
    cleanup.push(() => s2.kill());
    port = s2.port;
  };
  const id = await submit(port);
  const id2 = await submit(port);

  await t.test('reads need the agent token or the inbox key', async () => {
    for (const path of ['/api/approvals', `/api/approvals/${id}`]) {
      for (const [who, headers, want] of [['none', {}, 401], ['wrong key', wrongKey, 401],
        ['wrong agent', { 'x-agent-token': 'nope' }, 401], ['agent', agentHeaders, 200], ['inbox', inbox, 200]]) {
        const r = await call(port, 'GET', path, { headers });
        assert.equal(r.status, want, `GET ${path} as ${who}: ${r.text}`);
      }
    }
    const r = await call(port, 'GET', '/api/approvals/not-an-id');
    assert.equal(r.status, 401, 'auth runs before id validation');
  });

  await t.test('submit is agent-only and returns a token-less item_url', async () => {
    for (const headers of [{}, inbox, wrongKey]) {
      const r = await call(port, 'POST', '/api/approvals', { body: itemBody(), headers });
      assert.equal(r.status, 401, `submit as ${JSON.stringify(Object.keys(headers))}: ${r.text}`);
    }
    const r = await call(port, 'POST', '/api/approvals', { body: itemBody(), headers: agentHeaders });
    assert.equal(r.status, 201);
    assert.match(r.json.id, ID_FMT);
    assert.equal(r.json.item_url, `https://fleet.gamernight.net/?approval=${r.json.id}`);
    assert.ok(!r.json.item_url.includes(INBOX_KEY));
  });

  await t.test('submit rejects bad bodies: 400 / 413 / 415', async () => {
    const post = (body) => call(port, 'POST', '/api/approvals', { body, headers: agentHeaders });
    const noTitle = await post(itemBody({ title: undefined }));
    assert.equal(noTitle.status, 400, noTitle.text);
    const serverOwned = await post(itemBody({ status: 'approved' }));
    assert.equal(serverOwned.status, 400, `server-owned field accepted: ${serverOwned.text}`);
    const big = await post(itemBody({ files: { mockup_html: 'x'.repeat(600 * 1024) } }));
    assert.equal(big.status, 413, big.text);
    assert.equal(big.json?.error, 'mockup_too_large');
    const ok300 = await post(itemBody({ files: { mockup_html: `<p>${'x'.repeat(300 * 1024)}</p>` } }));
    assert.equal(ok300.status, 201, `300 KB mockup: ${ok300.text}`);
    const notImage = await post(itemBody({ files: { screenshots: [{ name: 'a.png', b64: Buffer.alloc(32, 7).toString('base64') }] } }));
    assert.equal(notImage.status, 400, notImage.text);
    assert.equal(notImage.json?.error, 'invalid_screenshot');
    const text = await raw(port, 'POST', '/api/approvals',
      { headers: { ...agentHeaders, 'content-type': 'text/plain' }, body: JSON.stringify(itemBody()) });
    assert.equal(text.status, 415, text.text);
    const badJson = await raw(port, 'POST', '/api/approvals',
      { headers: { ...agentHeaders, 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(badJson.status, 400, badJson.text);
  });

  await t.test('rulings and verdicts take ONLY the inbox key', async () => {
    for (const [sub, body] of [['ruling', { n: 1, choice: 'accept' }], ['verdict', { value: 'approve' }]]) {
      for (const [who, headers] of [['none', {}], ['agent', agentHeaders], ['wrong key', wrongKey]]) {
        const r = await call(port, 'POST', `/api/approvals/${id}/${sub}`, { body, headers });
        assert.equal(r.status, 401, `${sub} as ${who} must be refused: ${r.text}`);
      }
    }
    const item = (await call(port, 'GET', `/api/approvals/${id}`, { headers: inbox })).json.item;
    assert.equal(item.status, 'pending', 'refused writes changed nothing');
    assert.deepEqual(item.rulings, []);
  });

  await t.test('withdraw is agent-only', async () => {
    const r = await call(port, 'POST', `/api/approvals/${id2}/withdraw`, { body: {}, headers: inbox });
    assert.equal(r.status, 401, `inbox key withdrew: ${r.text}`);
  });

  await t.test('ruling: 200 with the note; 400 bad n; 404 unknown; 413 oversize', async () => {
    await fresh();
    const path = `/api/approvals/${id}/ruling`;
    const r = await call(port, 'POST', path, { body: { n: 2, choice: 'other', note: 'OPERATOR-NOTE-TEXT' }, headers: inbox });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.item.rulings[0]?.note, 'OPERATOR-NOTE-TEXT', 'the operator sees the note it wrote');
    assert.equal((await call(port, 'POST', path, { body: { n: 9, choice: 'accept' }, headers: inbox })).status, 400);
    const unknown = await call(port, 'POST', `/api/approvals/${UNKNOWN_ID}/ruling`, { body: { n: 1, choice: 'accept' }, headers: inbox });
    assert.equal(unknown.status, 404, unknown.text);
    const bad = await call(port, 'POST', '/api/approvals/x/ruling', { body: { n: 1, choice: 'accept' }, headers: inbox });
    assert.equal(bad.status, 400, bad.text);
    const big = await call(port, 'POST', path, { body: { n: 1, choice: 'other', note: 'y'.repeat(20 * 1024) }, headers: inbox });
    assert.equal(big.status, 413, big.text);
  });

  await t.test('notes are redacted on every read except agent + include_notes=1', async () => {
    const get = (suffix, headers) => call(port, 'GET', `/api/approvals/${id}${suffix}`, { headers });
    for (const [who, suffix, headers] of [['inbox', '', inbox], ['inbox+include', '?include_notes=1', inbox],
      ['agent', '', agentHeaders], ['agent include=0', '?include_notes=0', agentHeaders]]) {
      const r = await get(suffix, headers);
      assert.ok(!r.text.includes('OPERATOR-NOTE-TEXT'), `${who} read leaked the note: ${r.text}`);
      assert.equal(r.json.item.rulings[0]?.has_note, true, `${who}: has_note`);
    }
    const full = await get('?include_notes=1', agentHeaders);
    assert.equal(full.json.item.rulings[0]?.note, 'OPERATOR-NOTE-TEXT');
    const list = await call(port, 'GET', '/api/approvals?status=all', { headers: agentHeaders });
    assert.ok(!list.text.includes('OPERATOR-NOTE-TEXT'), 'list leaked a note');
  });

  await t.test('verdict approve decides the item; later writes 409', async () => {
    await fresh();
    const r = await call(port, 'POST', `/api/approvals/${id}/verdict`, { body: { value: 'approve' }, headers: inbox });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.item.status, 'approved');
    assert.ok(r.json.item.decided_at);
    assert.deepEqual(r.json.item.rulings.map((x) => [x.n, x.choice]), [[1, 'accept'], [2, 'other'], [3, 'accept']]);
    const again = await call(port, 'POST', `/api/approvals/${id}/verdict`, { body: { value: 'reject', note: 'n' }, headers: inbox });
    assert.equal(again.status, 409, again.text);
    const rule = await call(port, 'POST', `/api/approvals/${id}/ruling`, { body: { n: 1, choice: 'accept' }, headers: inbox });
    assert.equal(rule.status, 409, rule.text);
    const wd = await call(port, 'POST', `/api/approvals/${id}/withdraw`, { body: {}, headers: agentHeaders });
    assert.equal(wd.status, 409, wd.text);
    const changes = await call(port, 'POST', `/api/approvals/${id2}/verdict`, { body: { value: 'changes' }, headers: inbox });
    assert.equal(changes.status, 400, `changes without a note: ${changes.text}`);
  });

  await t.test('withdraw (agent) → withdrawn / superseded', async () => {
    const r = await call(port, 'POST', `/api/approvals/${id2}/withdraw`, { body: { reason: 'stale' }, headers: agentHeaders });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.status, 'withdrawn');
    const id3 = await submit(port);
    const s = await call(port, 'POST', `/api/approvals/${id3}/withdraw`, { body: { superseded_by: id }, headers: agentHeaders });
    assert.equal(s.json?.status, 'superseded', s.text);
  });

  await t.test('list filters + counts; unknown filter 400; plan_steps array', async () => {
    const pending = await call(port, 'GET', '/api/approvals', { headers: inbox });
    assert.deepEqual(Object.keys(pending.json).sort(), ['counts', 'items', 'ok', 'plan_steps']);
    assert.ok(Array.isArray(pending.json.plan_steps));
    assert.ok(pending.json.items.every((i) => i.status === 'pending'));
    const decided = await call(port, 'GET', '/api/approvals?status=decided', { headers: inbox });
    assert.ok(decided.json.items.some((i) => i.id === id && i.status === 'approved'));
    assert.equal(decided.json.counts.decided, decided.json.items.length);
    assert.equal((await call(port, 'GET', '/api/approvals?status=bogus', { headers: inbox })).status, 400);
  });

  await t.test('nothing deletes: DELETE / PUT on approval paths → 405', async () => {
    await fresh();
    for (const [method, path] of [['DELETE', '/api/approvals'], ['DELETE', `/api/approvals/${id}`],
      ['PUT', `/api/approvals/${id}`], ['DELETE', `/api/approvals/${id}/ruling`], ['GET', `/api/approvals/${id}/verdict`]]) {
      const r = await call(port, method, path, { headers: { ...agentHeaders, ...inbox } });
      assert.equal(r.status, 405, `${method} ${path}: ${r.text}`);
    }
    assert.equal((await call(port, 'GET', `/api/approvals/${id}/nope`, { headers: inbox })).status, 404);
  });

  await t.test('items survive plan deletion and a server restart', async () => {
    const del = await call(port, 'DELETE', '/api/test-plans/foo', { headers: agentHeaders });
    assert.ok(del.status < 500, `plan delete: ${del.text}`);
    await fresh();
    const r = await call(port, 'GET', `/api/approvals/${id}`, { headers: inbox });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.item.status, 'approved');
    assert.ok((await readdir(join(dir, 'approvals'))).includes(id));
  });
});
