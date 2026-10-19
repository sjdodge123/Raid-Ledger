// ROK-1846 c7 (Codex r7, 3 x P2) — stream lifecycle at the guard:
//  1. a client that goes away tears down the upstream Docker request/response
//     (a cancelled build or a dropped /events subscription stops daemon-side);
//  2. a spool write error (ENOSPC) fails ONE upload, never the shared process;
//  3. a corrupt gzip header settles the upload promptly and removes its temp dir.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { forward } from '../src/forward.mjs';
import { spoolBuildContext } from '../src/build-context.mjs';

/** Resolves true when `p` settles within `ms`, false otherwise (a bound, not a sleep). */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms).unref())]);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-c7-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const ctxDirs = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('rlg-ctx-'));

/** A fake daemon (unix socket) that records when each upstream exchange closes. */
async function upstreamAndProxy(onUpstream) {
  const sock = path.join(fs.mkdtempSync(path.join(scratch, 'd-')), 'd.sock');
  const daemon = http.createServer(onUpstream);
  await new Promise((r) => daemon.listen(sock, r));
  const proxy = http.createServer((req, res) => forward(sock, req, res, undefined, () => res.destroy()));
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const port = proxy.address().port;
  return { port, close: () => { daemon.closeAllConnections(); proxy.closeAllConnections(); daemon.close(); proxy.close(); } };
}

test('a client that drops a streaming response (/events, /logs) closes the upstream response', async () => {
  let upClosed;
  const closed = new Promise((r) => { upClosed = r; });
  const env = await upstreamAndProxy((req, res) => {
    res.on('close', upClosed);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"status":"start"}\n');
  });
  try {
    const client = http.get({ host: '127.0.0.1', port: env.port, path: '/events', agent: false }, (res) => res.once('data', () => client.destroy()));
    client.on('error', () => {});
    assert.equal(await within(closed, 3000), true, 'upstream /events response stayed open after the client disconnected');
  } finally { env.close(); }
});

test('a client that aborts mid-upload (cancelled build) closes the upstream request', async () => {
  let upClosed;
  let gotChunk;
  const closed = new Promise((r) => { upClosed = r; });
  const chunk = new Promise((r) => { gotChunk = r; });
  const env = await upstreamAndProxy((req, res) => {
    res.on('close', upClosed);
    req.once('data', gotChunk);
  });
  try {
    const client = http.request({ host: '127.0.0.1', port: env.port, method: 'POST', path: '/build', agent: false, headers: { 'Transfer-Encoding': 'chunked' } });
    client.on('error', () => {});
    client.write(Buffer.alloc(1024, 1));
    assert.equal(await within(chunk, 3000), true, 'upload never reached the fake daemon');
    client.destroy();
    assert.equal(await within(closed, 3000), true, 'upstream /build request stayed open after the client aborted the upload');
  } finally { env.close(); }
});

// The ENOSPC case runs in a child process: an unhandled stream 'error' kills the
// process, which is exactly the failure — the child must survive and print 507.
const CHILD = `
import fs from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
const { spoolBuildContext } = await import(process.argv[1]);
fs.createWriteStream = () => new Writable({ write(c, e, cb) { cb(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })); } });
const input = new PassThrough();
const done = spoolBuildContext(input, 'Dockerfile', process.argv[2]);
input.end(Buffer.alloc(2048, 0x61));
const r = await done;
console.log(JSON.stringify({ status: r.error?.status ?? null }));
`;

test('an ENOSPC on the spool file fails that upload with 507, removes its temp dir and does not crash the process', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'enospc-'));
  const mod = new URL('../src/build-context.mjs', import.meta.url).href;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD, mod, dir], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 0, `the guard process crashed on a spool ENOSPC (exit ${run.status}): ${run.stderr.split('\n').find((l) => /^\w*Error:/.test(l)) ?? ''}`);
  assert.equal(JSON.parse(run.stdout.trim()).status, 507);
  assert.deepEqual(ctxDirs(dir), [], 'the temp build context was not removed');
});

test('a corrupt gzip header settles the upload promptly as 400 and removes its temp dir', async () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'gz-'));
  const input = new PassThrough();
  let result;
  const done = spoolBuildContext(input, 'Dockerfile', dir).then((r) => { result = r; });
  // Header only: the gunzip error settles before the upload ends. The request
  // must be refused then — and must not hang once the upload does end.
  input.write(Buffer.from([0x1f, 0x8b, 0x99, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]));
  try {
    assert.equal(await within(done, 3000), true, 'a corrupt gzip header was not refused until the upload ended');
    assert.equal(result?.error?.status, 400);
    assert.deepEqual(ctxDirs(dir), [], 'the temp build context was not removed');
  } finally { input.end(); }
  assert.equal(await within(done, 3000), true, 'spoolBuildContext hung after a corrupt gzip upload ended (close fired before its listener)');
});
