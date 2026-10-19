// ROK-1846 c8 (Codex r8, 2 x P2):
//  1. a runner that disconnects after uploading its context but before the spool
//     resolves gets nothing forwarded, and its temp context is removed;
//  2. GUARD_ALLOW_BUILDKIT=1 does not open BuildKit: /session and /grpc are a
//     400 buildkit_session_unsupported, announced by one startup warning.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { Writable } from 'node:stream';
import { createGuardServer } from '../src/guard.mjs';
import { classify } from '../src/routes.mjs';
import { tarOf } from './tar-fixture.mjs';

/** Resolves true when `p` settles within `ms`, false otherwise (a bound, not a sleep). */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms).unref())]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-c8-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const ctxDirs = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('rlg-ctx-'));
const DOCKERFILE = 'FROM node:22-alpine AS deps\nCOPY package.json ./\nFROM alpine\nCOPY --from=deps /app /app\n';

/** A daemon that records every request the moment it arrives. */
async function recordingDaemon() {
  const sock = path.join(fs.mkdtempSync(path.join(scratch, 'd-')), 'd.sock');
  const seen = [];
  const daemon = http.createServer((req, res) => { seen.push(req.url); res.end('{}'); });
  daemon.on('upgrade', (req, s) => { seen.push(req.url); s.destroy(); });
  await new Promise((r) => daemon.listen(sock, r));
  return { sock, seen, close: () => { daemon.closeAllConnections(); daemon.close(); } };
}

/** Patch the spool's write stream so its final flush waits for release(). */
function holdSpoolFlush() {
  const orig = fs.createWriteStream;
  let release;
  let flushing;
  const released = new Promise((r) => { release = r; });
  const reached = new Promise((r) => { flushing = r; });
  fs.createWriteStream = (p, o) => {
    const real = orig(p, o);
    return new Writable({
      write: (c, e, cb) => real.write(c, cb),
      final: (cb) => { flushing(); released.then(() => real.end(cb)); },
    });
  };
  return { reached, release, restore: () => { fs.createWriteStream = orig; } };
}

test('a client that aborts after its upload but before the spool resolves: nothing forwarded, temp context removed', async () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'ctx-'));
  const daemon = await recordingDaemon();
  const guard = createGuardServer({ socket: daemon.sock, tmpDir: dir });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  const hold = holdSpoolFlush();
  try {
    const conn = new Promise((r) => guard.once('connection', (s) => s.once('close', r)));
    const tar = tarOf([{ name: 'Dockerfile', data: DOCKERFILE }, { name: 'package.json', data: '{}' }]);
    const client = http.request({ host: '127.0.0.1', port: guard.address().port, method: 'POST', path: '/build?t=rl:ci-test',
      headers: { 'Content-Type': 'application/x-tar', 'Content-Length': String(tar.length) }, agent: false });
    client.on('error', () => {});
    client.end(tar);
    assert.equal(await within(hold.reached, 3000), true, 'the upload never reached the spool flush');
    client.destroy();
    assert.equal(await within(conn, 3000), true, 'the guard never saw the client disconnect');
    hold.release();
    const gone = new Promise((r) => { const t = setInterval(() => { if (ctxDirs(dir).length === 0) { clearInterval(t); r(); } }, 10); t.unref(); });
    assert.equal(await within(gone, 3000), true, `the cancelled build's temp context was not removed: ${ctxDirs(dir).join(',')}`);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(daemon.seen.filter((u) => u.includes('/build')), [], 'a cancelled build context was still forwarded upstream');
  } finally {
    hold.restore();
    guard.closeAllConnections();
    guard.close();
    daemon.close();
  }
});

/** A raw upgrade request; resolves the guard's whole reply text. */
function rawUpgrade(port, urlPath) {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`POST ${urlPath} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: h2c\r\nContent-Length: 0\r\n\r\n`));
    let text = '';
    s.on('data', (c) => { text += c; });
    s.on('end', () => resolve(text));
    s.on('error', reject);
  });
}

test('GUARD_ALLOW_BUILDKIT=1: one startup warning; /session and /grpc are 400 buildkit_session_unsupported', async () => {
  const daemon = await recordingDaemon();
  const lines = [];
  const guard = createGuardServer({ socket: daemon.sock, allowBuildkit: true, logger: (m) => lines.push(m) });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  try {
    const port = guard.address().port;
    for (const p of ['/session', '/v1.45/session', '/grpc']) {
      const reply = await rawUpgrade(port, p);
      assert.match(reply, /^HTTP\/1\.1 400 /, `${p} upgrade was not refused 400: ${reply.split('\r\n')[0]}`);
      assert.match(reply, /buildkit_session_unsupported/, `${p} refusal does not say buildkit_session_unsupported`);
    }
    assert.equal(classify('POST', '/session', { allowBuildkit: true }).status, 400);
    assert.match(classify('POST', '/grpc', { allowBuildkit: true }).reason ?? '', /^buildkit_session_unsupported/);
    assert.equal(classify('POST', '/session').status, undefined, 'without the flag /session stays a plain allowlist 403');
    assert.deepEqual(daemon.seen, [], 'a BuildKit route reached the daemon');
    const warnings = lines.filter((l) => /GUARD_ALLOW_BUILDKIT/.test(l) && /not proxied/.test(l));
    assert.equal(warnings.length, 1, `expected one BuildKit startup warning, got ${warnings.length}`);
  } finally {
    guard.closeAllConnections();
    guard.close();
    daemon.close();
  }
});
