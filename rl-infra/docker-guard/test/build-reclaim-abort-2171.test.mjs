// ROK-2171 Codex P1 (round 2) — a reclaim DELETE whose response the daemon cuts
// off after the headers, before the body ends, must settle as a failed request.
// It used to leave its promise in the deletion barrier forever, so every later
// guarded build hung in beginBuild().
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { beginBuild, buildsInFlight, setDeleteTimeoutMs } from '../src/build-reclaim.mjs';
import { dockerJson } from '../src/docker-client.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'reclaim-abort-2171-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;

const reply = (sock, body) => {
  const s = JSON.stringify(body);
  sock.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(s)}\r\nConnection: close\r\n\r\n${s}`);
};

/**
 * A raw daemon on a unix socket. `truncate(method)` true → that request gets a
 * 200 with Content-Length 100, one body byte, then the socket closes.
 */
async function rawDaemon(truncate) {
  const sockPath = path.join(fs.mkdtempSync(path.join(scratch, 'd-')), 'd.sock');
  const seen = [];
  let current = OLD;
  const server = net.createServer((sock) => {
    let buf = '';
    sock.on('data', (c) => {
      buf += c.toString('utf8');
      if (!buf.includes('\r\n\r\n')) return;
      const [method, rawUrl] = buf.split(' ');
      const url = decodeURIComponent(rawUrl ?? '');
      seen.push(`${method} ${url}`);
      if (truncate(method)) {
        sock.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n[');
        return setTimeout(() => sock.destroy(), 10);
      }
      if (url.startsWith('/containers/json')) return reply(sock, []);
      if (url === '/images/rl:ci-test/json') return reply(sock, { Id: current, RepoTags: ['rl:ci-test'], Config: { Labels: {} } });
      return reply(sock, { Id: OLD, RepoTags: [], Config: { Labels: {} } });
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(sockPath, r));
  return { sockPath, seen, moveTag: () => { current = NEW; }, close: () => server.close() };
}

const within = (p, ms, label) => Promise.race([p, new Promise((r) => { setTimeout(() => r(label), ms).unref(); })]);

test('Codex P1: dockerJson settles {status:0} when the body is cut off after the headers', async () => {
  const d = await rawDaemon(() => true);
  try {
    const out = await within(dockerJson(d.sockPath, 'DELETE', '/images/x'), 2000, 'NEVER SETTLED');
    assert.deepEqual(out, { status: 0, json: null }, 'a truncated response must resolve as a failed request');
  } finally { d.close(); }
});

test('Codex P1: dockerJson with a timeout still settles once when the body is cut off', async () => {
  const d = await rawDaemon(() => true);
  try {
    const out = await within(dockerJson(d.sockPath, 'DELETE', '/images/x', undefined, { timeoutMs: 60000 }), 2000, 'NEVER SETTLED');
    assert.deepEqual(out, { status: 0, json: null }, 'a truncated response must not wait for the 60 s timeout');
  } finally { d.close(); }
});

test('Codex P1: a reclaim DELETE cut off mid-body is logged as kept and the next build is admitted', async () => {
  const d = await rawDaemon((m) => m === 'DELETE');
  const lines = [];
  setDeleteTimeoutMs(60000); // the fix must not rely on the timeout
  try {
    const end = await beginBuild(d.sockPath, ['rl:ci-test'], (m) => lines.push(m));
    d.moveTag();
    const removal = end(true);
    const next = await within(
      (async () => { await removal; (await beginBuild('/nonexistent.sock', ['rl:other'], () => {}))(false); return 'admitted'; })(),
      2000, 'NEXT BUILD STILL BLOCKED after a cut-off DELETE');
    assert.equal(next, 'admitted');
  } finally { setDeleteTimeoutMs(0); d.close(); }
  assert.deepEqual(d.seen.filter((s) => s.startsWith('DELETE')), [`DELETE /images/${OLD}`]);
  assert.deepEqual(lines, [`RECLAIM kept previous rl:ci-test ${OLD}: DELETE unanswered after 60000 ms (timeout or daemon error; dangling_prune reclaims it)`]);
  assert.equal(buildsInFlight(), 0);
});
