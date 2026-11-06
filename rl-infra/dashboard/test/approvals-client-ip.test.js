// ROK-1900 delta review MAJOR — per-IP approval limits behind Cloudflare ->
// Traefik: CF-Connecting-IP is honoured ONLY from a trusted proxy peer, so each
// visitor gets its own read and auth-failure bucket; from any other peer the
// header is ignored. Plus MINOR: an expired-but-genuine ?t= is not counted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { call, makeStateDir, startServer } from './auth-harness.js';
import { createClientIp, touchBucket } from '../client-ip.js';
import { createApprovalLimits, preGate } from '../approvals-limits.js';
import { createApprovalContent } from '../approvals-content.js';
import { createContentSigner } from '../approvals-sign.js';

const INBOX_KEY = 'operator-inbox-key-client-ip';
const LOOPBACK = '127.0.0.1,::ffff:127.0.0.1,::1';
const ID = '2026-11-01-1200-aaaa';
const cleanup = [];
test.after(async () => { for (const fn of cleanup.reverse()) await fn(); });

const boot = async (env) => {
  const dir = await makeStateDir();
  const srv = await startServer(dir, { approvalToken: INBOX_KEY, env });
  cleanup.push(() => srv.kill(), () => rm(dir, { recursive: true, force: true }));
  return srv.port;
};
const guess = (port, cf, i) => call(port, 'GET', '/api/approvals', {
  headers: { 'x-approval-token': `guess-${i}`, 'cf-connecting-ip': cf },
});
const reqFrom = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });

test('clientIp: CF-Connecting-IP only from a trusted peer; XFF walk; resolved proxy hosts', async () => {
  const plain = createClientIp({ env: {} });
  assert.equal(plain.clientIp(reqFrom('10.0.0.9', { 'cf-connecting-ip': '203.0.113.7' })), '10.0.0.9',
    'untrusted peer: the header is ignored');
  const cidr = createClientIp({ env: { RL_TRUSTED_PROXY_CIDRS: '172.18.0.0/16' } });
  assert.equal(cidr.clientIp(reqFrom('::ffff:172.18.0.4', { 'cf-connecting-ip': '203.0.113.7' })), '203.0.113.7');
  assert.equal(cidr.clientIp(reqFrom('172.18.0.4', { 'cf-connecting-ip': 'not-an-ip', 'x-forwarded-for': '198.51.100.2, 172.18.0.3' })),
    '198.51.100.2', 'bad CF header falls back to the XFF walk');
  assert.equal(cidr.clientIp(reqFrom('172.19.0.4', { 'cf-connecting-ip': '203.0.113.7' })), '172.19.0.4', 'outside the CIDR');
  const byHost = createClientIp({
    env: { RL_TRUSTED_PROXY_HOSTS: 'traefik' },
    resolve: async (h) => (h === 'traefik' ? [{ address: '172.18.0.2' }] : []),
  });
  assert.equal(byHost.clientIp(reqFrom('172.18.0.2', { 'cf-connecting-ip': '203.0.113.7' })), '172.18.0.2', 'before resolution');
  await byHost.refresh();
  assert.equal(byHost.clientIp(reqFrom('172.18.0.2', { 'cf-connecting-ip': '203.0.113.7' })), '203.0.113.7', 'traefik trusted');
  assert.equal(byHost.clientIp(reqFrom('172.18.0.5', { 'cf-connecting-ip': '203.0.113.7' })), '172.18.0.5',
    'another rl-net container is not trusted');
});

test('behind a trusted proxy each CF-Connecting-IP has its own auth-failure and read bucket', async () => {
  const port = await boot({ RL_TRUSTED_PROXY_CIDRS: LOOPBACK, RL_APPROVAL_AUTH_FAIL_MAX: '2', RL_APPROVAL_READ_MAX: '4' });
  for (let i = 0; i < 2; i += 1) assert.equal((await guess(port, '203.0.113.1', i)).status, 401);
  assert.equal((await guess(port, '203.0.113.1', 9)).status, 429, 'the guessing visitor is locked out');
  const other = await guess(port, '203.0.113.2', 9);
  assert.equal(other.status, 401, `another visitor behind the same proxy is not locked out: ${other.text}`);
  // Reads: 203.0.113.1 has used 3 of 4 (the read cap runs before the
  // lockout, so the locked-out guess counts too); one more passes, the next
  // is capped, while 203.0.113.3 is untouched.
  const read = (cf) => call(port, 'GET', '/api/approvals', { headers: { 'x-approval-token': INBOX_KEY, 'cf-connecting-ip': cf } });
  assert.equal((await read('203.0.113.1')).status, 200, 'valid key on a locked-out visitor');
  assert.equal((await read('203.0.113.1')).status, 429, 'read cap is per visitor');
  assert.equal((await read('203.0.113.3')).status, 200, 'other visitor reads freely');
});

test('from an untrusted peer CF-Connecting-IP is ignored (no bucket hopping)', async () => {
  const port = await boot({ RL_APPROVAL_AUTH_FAIL_MAX: '2' });
  for (let i = 0; i < 2; i += 1) assert.equal((await guess(port, '203.0.113.1', i)).status, 401);
  const hop = await guess(port, '203.0.113.2', 9);
  assert.equal(hop.status, 429, `a forged CF-Connecting-IP from an untrusted peer must not escape the lockout: ${hop.text}`);
});

test('an expired-but-genuine ?t= is 403 content_token_expired and is not counted; a forged one is', async () => {
  let t = 1_700_000_000_000;
  const signer = createContentSigner({ now: () => t });
  const limits = createApprovalLimits({ env: { RL_APPROVAL_AUTH_FAIL_MAX: '1' } });
  const auth = { deny: () => ({ status: 401, error: 'approval_token_required' }), isAgent: () => false, isOperator: () => false };
  const handler = createApprovalContent({ store: {}, auth, signer, limits, ipOf: () => '203.0.113.9' });
  const get = async (url) => {
    const res = { status: 0, body: '', writeHead(s) { this.status = s; }, end(b) { this.body = String(b ?? ''); } };
    await handler({ method: 'GET', url, headers: {} }, res, url.split('?')[0]);
    return res;
  };
  const { url } = signer.sign(ID, 'mockup.html');
  t += 11 * 60 * 1000;
  const expired = await get(url);
  assert.equal(expired.status, 403);
  assert.match(expired.body, /content_token_expired/);
  assert.equal(limits.lockedOut('203.0.113.9'), false, 'an expired genuine token must not count as an auth failure');
  const forged = await get(url.replace(/\.[^.]+$/, `.${'A'.repeat(43)}`));
  assert.match(forged.body, /content_token_invalid/);
  assert.equal(limits.lockedOut('203.0.113.9'), true, 'a forged token counts');
});

// Round-4 MINOR: the read cap runs before the valid-header-auth lockout
// exemption, so a locked-out IP cannot try keys unthrottled and read
// 429-vs-200 as an oracle.
const fakeRes = () => {
  const r = { status: 0, body: '' };
  r.writeHead = (st) => { r.status = st; };
  r.end = (b) => { r.body = String(b ?? ''); };
  return r;
};
test('a locked-out IP spends its read budget on every guess, so the valid key is no unthrottled oracle', () => {
  const ip = '198.51.100.9';
  const limits = createApprovalLimits({ env: { RL_APPROVAL_READ_MAX: '3', RL_APPROVAL_AUTH_FAIL_MAX: '1' } });
  limits.recordFailure(ip);
  const auth = { isOperator: (req) => req.headers['x-approval-token'] === 'the-real-key', isAgent: () => false };
  const get = (tok) => {
    const r = fakeRes();
    const answered = preGate(limits, ip, { method: 'GET', headers: { 'x-approval-token': tok } }, r, auth);
    return { answered, ...r };
  };
  for (let i = 0; i < 3; i += 1) assert.match(get(`guess-${i}`).body, /too_many_auth_failures/);
  const probe = get('the-real-key');
  assert.equal(probe.status, 429, 'the locked-out guesses must have used the read cap; the valid key must not get through');
  assert.match(probe.body, /rate_limit_exceeded/);
});

test('a LAN client connecting directly and rotating CF-Connecting-IP / XFF gets ONE bucket', () => {
  for (const env of [{}, { RL_TRUSTED_PROXY_CIDRS: '172.18.0.0/16' }]) {
    const ips = createClientIp({ env });
    const limits = createApprovalLimits({ env: { RL_APPROVAL_AUTH_FAIL_MAX: '3' } });
    const keys = new Set();
    for (let i = 0; i < 5; i += 1) {
      const ip = ips.clientIp(reqFrom('192.168.0.50', { 'cf-connecting-ip': `203.0.113.${i}`, 'x-forwarded-for': `198.51.100.${i}` }));
      keys.add(ip);
      limits.recordFailure(ip);
    }
    assert.deepEqual([...keys], ['192.168.0.50'], 'keyed by the socket peer only');
    assert.equal(limits.lockedOut('192.168.0.50'), true, 'all rotated guesses land in the one bucket');
  }
});

test('bucket maps are bounded with O(1) least-recently-touched eviction', () => {
  const m = new Map();
  for (const k of ['a', 'b', 'c']) touchBucket(m, k, [1], 3);
  touchBucket(m, 'a', [2], 3); // a becomes newest
  touchBucket(m, 'd', [1], 3); // evicts b, the oldest
  assert.deepEqual([...m.keys()], ['c', 'a', 'd']);
  const limits = createApprovalLimits({ env: { RL_APPROVAL_READ_MAX: '1' }, bucketCap: 2 });
  assert.equal(limits.readOk('ip-1'), true);
  assert.equal(limits.readOk('ip-1'), false, 'ip-1 is capped');
  limits.readOk('ip-2');
  limits.readOk('ip-3'); // third key past cap 2: ip-1 (least recent) is evicted
  assert.equal(limits.readOk('ip-1'), true, 'the evicted bucket starts fresh — the map never exceeds the cap');
});
