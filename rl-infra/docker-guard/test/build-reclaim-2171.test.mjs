// ROK-2171 — a finished /build that moves `rl:ci-test` removes the image it
// replaced, and only when that is safe; a failed removal never fails the build.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGuardServer } from '../src/guard.mjs';
import { buildsInFlight, reclaimSettled } from '../src/build-reclaim.mjs';
import { tarOf } from './tar-fixture.mjs';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-2171-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const OLD = `sha256:${'a'.repeat(64)}`;
const NEW = `sha256:${'b'.repeat(64)}`;
const TAR = tarOf([{ name: 'Dockerfile', data: 'FROM alpine\n' }]);

/**
 * A daemon whose `rl:ci-test` points at OLD until a build of it completes, then
 * at NEW. `opts`: oldLabels, users (containers using OLD, or 'fail'), deleteStatus,
 * holdTag (a build of that tag answers only when release() is called), sameImage.
 */
async function fakeDaemon(opts = {}) {
  const sock = path.join(fs.mkdtempSync(path.join(scratch, 'd-')), 'd.sock');
  const seen = [];
  let current = OLD;
  let release;
  const held = new Promise((r) => { release = r; });
  const send = (res, status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  const daemon = http.createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      const url = decodeURIComponent(req.url ?? '');
      seen.push(`${req.method} ${url}`);
      if (url.startsWith('/build')) {
        if (opts.holdTag && url.includes(`t=${opts.holdTag}`)) await held;
        else if (!opts.sameImage) current = NEW;
        return res.end('{"stream":"built"}');
      }
      if (req.method === 'GET' && url === '/images/rl:ci-test/json') return send(res, 200, { Id: current, Config: { Labels: {} } });
      if (req.method === 'GET' && url === `/images/${OLD}/json`) return send(res, 200, { Id: OLD, Config: { Labels: opts.oldLabels ?? {} } });
      if (url.startsWith('/containers/json')) {
        if (opts.users === 'fail') return send(res, 500, { message: 'boom' });
        return send(res, 200, Array.from({ length: opts.users ?? 0 }, (_, i) => ({ Id: `c${i}` })));
      }
      if (req.method === 'DELETE') return send(res, opts.deleteStatus ?? 200, opts.deleteStatus ? { message: 'conflict: image is being used' } : [{ Deleted: OLD }]);
      send(res, 404, { message: 'no such object' });
    });
  });
  await new Promise((r) => daemon.listen(sock, r));
  return { sock, seen, release: () => release(), close: () => { daemon.closeAllConnections(); daemon.close(); } };
}

function build(port, tag) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/build?t=${tag}`, agent: false,
      headers: { 'Content-Type': 'application/x-tar', 'Content-Length': String(TAR.length) } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end(TAR);
  });
}

/** Run `fn(port)` against a guard over `daemon`; resolves once a RECLAIM line (or none) settles. */
async function withGuard(daemon, fn) {
  const lines = [];
  const guard = createGuardServer({ socket: daemon.sock, tmpDir: fs.mkdtempSync(path.join(scratch, 'ctx-')), logger: (m) => lines.push(m) });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  try {
    await fn(guard.address().port);
    // Bounded poll until every build's response closed, then await its removal attempt.
    for (let i = 0; i < 400 && buildsInFlight() > 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal(buildsInFlight(), 0, 'a build never closed');
    await reclaimSettled();
  } finally {
    guard.closeAllConnections();
    guard.close();
    daemon.close();
  }
  return lines.filter((l) => l.startsWith('RECLAIM'));
}

const deletes = (d) => d.seen.filter((s) => s.startsWith('DELETE'));

test('rl:ci-test rebuilt: the previous image is removed, the new one kept', async () => {
  const d = await fakeDaemon();
  const lines = await withGuard(d, async (port) => assert.equal((await build(port, 'rl:ci-test')).status, 200));
  assert.deepEqual(deletes(d), [`DELETE /images/${OLD}`], `expected exactly the old image deleted, saw ${JSON.stringify(d.seen)}`);
  assert.ok(!d.seen.includes(`DELETE /images/${NEW}`), 'the new rl:ci-test must never be deleted');
  assert.deepEqual(lines, [`RECLAIM removed previous rl:ci-test ${OLD}`]);
});

test('a build of another tag never removes anything', async () => {
  const d = await fakeDaemon();
  await withGuard(d, async (port) => assert.equal((await build(port, 'rl:other')).status, 200));
  assert.deepEqual(deletes(d), [], 'only rl:ci-test predecessors are reclaimed');
});

test('a build that leaves rl:ci-test on the same image removes nothing', async () => {
  const d = await fakeDaemon({ sameImage: true });
  await withGuard(d, async (port) => build(port, 'rl:ci-test'));
  assert.deepEqual(deletes(d), [], 'unchanged tag: the current image is the old one');
});

test('the previous image labelled rl.role=runner is kept', async () => {
  const d = await fakeDaemon({ oldLabels: { 'rl.role': 'runner' } });
  const lines = await withGuard(d, async (port) => build(port, 'rl:ci-test'));
  assert.deepEqual(deletes(d), [], 'a runner image must never be removed');
  assert.match(lines.join('\n'), /kept previous rl:ci-test .*rl\.role=runner/);
});

test('the previous image a container still uses is kept; an unreadable list keeps it too', async () => {
  for (const users of [1, 'fail']) {
    const d = await fakeDaemon({ users });
    const lines = await withGuard(d, async (port) => build(port, 'rl:ci-test'));
    assert.deepEqual(deletes(d), [], `users=${users}: an image in use (or unknown) must be kept`);
    assert.match(lines.join('\n'), /kept previous rl:ci-test/);
  }
});

test('another build in flight keeps the previous image (possible cache parent)', async () => {
  const d = await fakeDaemon({ holdTag: 'rl:other' });
  await withGuard(d, async (port) => {
    const other = build(port, 'rl:other');
    for (let i = 0; i < 200 && !d.seen.some((s) => s.startsWith('POST /build?t=rl:other')); i += 1) await new Promise((r) => setTimeout(r, 5));
    assert.equal((await build(port, 'rl:ci-test')).status, 200);
    for (let i = 0; i < 400 && buildsInFlight() > 1; i += 1) await new Promise((r) => setTimeout(r, 5));
    await reclaimSettled();
    assert.deepEqual(deletes(d), [], 'no removal while another build is in flight');
    d.release();
    await other;
  });
  assert.deepEqual(deletes(d), [], 'the other build finishing does not retroactively remove it');
});

test('a refused DELETE is logged and the build still succeeds', async () => {
  const d = await fakeDaemon({ deleteStatus: 409 });
  let reply;
  const lines = await withGuard(d, async (port) => { reply = await build(port, 'rl:ci-test'); });
  assert.equal(reply.status, 200, 'the build response is unaffected by the failed removal');
  assert.equal(reply.body, '{"stream":"built"}');
  assert.match(lines.join('\n'), /kept previous rl:ci-test .*DELETE 409 conflict/);
});
