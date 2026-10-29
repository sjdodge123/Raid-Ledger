// ROK-1846 c9 (PROOF-1681, live rollback) — normal fleet work through the guard:
//  1. `docker run` calls attach (Upgrade: tcp) and `wait?condition=next-exit`
//     BEFORE it starts the container, and waits for their response HEADERS.
//     The daemon flushes those headers at once; the guard must relay them at
//     once too, or the container stays `Created` forever.
//  2. docker-modem (testcontainers) copies the whole create body into the query
//     string, so array fields (`Cmd`, `Env`) arrive as repeated query keys.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import querystring from 'node:querystring';
import { createGuardServer } from '../src/guard.mjs';
import { classify } from '../src/routes.mjs';
import { parseQuery } from '../src/query-parse.mjs';

/** Resolves true when `p` settles within `ms`, false otherwise (a bound, not a sleep). */
const within = (p, ms) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), ms).unref())]);
const RUNNER = { Names: ['/rl-runner-2'], Labels: { 'com.docker.compose.service': 'runner-2', 'com.docker.compose.project': 'rl-infra' },
  NetworkSettings: { Networks: { guard: { IPAddress: '127.0.0.1' } } } };
const RAW_STREAM = 'application/vnd.docker.raw-stream';

/** A daemon that answers wait / attach the way dockerd does: headers now, body when the container exits. */
async function runDaemon() {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-c9-')), 'd.sock');
  const seen = [];
  let exit;
  const exited = new Promise((r) => { exit = r; });
  const daemon = http.createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(`${req.method} ${url}`);
    req.resume();
    if (url.startsWith('/containers/json')) return res.end(JSON.stringify([RUNNER]));
    if (url === '/containers/c-mine/json') return res.end(JSON.stringify({ Config: { Labels: { 'rl.guard.owner': 'slot-2' } } }));
    if (url.startsWith('/containers/c-mine/wait') || url.startsWith('/containers/c-mine/attach')) {
      res.writeHead(200, { 'Content-Type': url.includes('/wait') ? 'application/json' : RAW_STREAM });
      res.flushHeaders();
      return void exited.then(() => res.end(url.includes('/wait') ? '{"StatusCode":0}' : ''));
    }
    if (url === '/containers/c-mine/start') {
      res.statusCode = 204;
      res.end();
      return exit();
    }
    res.statusCode = 404;
    res.end('{"message":"no such object"}');
  });
  daemon.on('upgrade', (req, s) => {
    seen.push(`UPGRADE ${req.url}`);
    s.write(`HTTP/1.1 101 UPGRADED\r\nContent-Type: ${RAW_STREAM}\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n`);
    exited.then(() => s.end());
  });
  await new Promise((r) => daemon.listen(sock, r));
  return { sock, seen, exit, close: () => { exit(); daemon.closeAllConnections(); daemon.close(); } };
}

let daemon;
let guard;
let port;
before(async () => {
  daemon = await runDaemon();
  guard = createGuardServer({ socket: daemon.sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  port = guard.address().port;
});
after(async () => {
  daemon.close();
  guard.closeAllConnections();
  await new Promise((r) => guard.close(r));
});

/** POST through the guard; resolves the response as soon as its headers arrive. */
function headers(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: p, agent: false, headers: { 'Content-Length': '0' } }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** Open the CLI's attach hijack; resolves the socket + the first bytes the guard relayed. */
function hijackAttach() {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write('POST /containers/c-mine/attach?stream=1&stdout=1&stderr=1 HTTP/1.1\r\nHost: d\r\nContent-Length: 0\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n'));
    let out = '';
    s.on('data', (c) => { out += c.toString('latin1'); if (out.includes('\r\n\r\n')) resolve({ s, out }); });
  });
}

test('docker run sequence: attach hijack, then wait headers, both BEFORE start; then wait answers', async () => {
  const attach = hijackAttach();
  assert.equal(await within(attach, 2000), true, 'POST /containers/c-mine/attach (Upgrade: tcp) got no 101 through the guard: docker run blocks before start');
  const { s, out } = await attach;
  assert.match(out, /^HTTP\/1\.1 101 /, `attach was not upgraded: ${out}`);
  const wait = headers('/containers/c-mine/wait?condition=next-exit');
  assert.equal(await within(wait, 2000), true,
    'POST /containers/c-mine/wait?condition=next-exit: the daemon flushed its headers but the guard relayed none while the container is still Created (docker run never reaches start)');
  const res = await wait;
  assert.equal(res.statusCode, 200);
  assert.equal(daemon.seen.includes('POST /containers/c-mine/start'), false, 'start must not have been sent yet');
  const start = await headers('/containers/c-mine/start');
  assert.equal(start.statusCode, 204);
  let body = '';
  res.on('data', (c) => { body += c; });
  await new Promise((r) => res.on('end', r));
  assert.equal(body, '{"StatusCode":0}');
  s.destroy();
});

test('a plain (non-upgrade) attach relays its 200 headers before any stream output', async () => {
  const p = headers('/containers/c-mine/attach?stream=1&stdout=1');
  assert.equal(await within(p, 2000), true, 'POST /containers/c-mine/attach without Upgrade: the daemon flushed 200 but the guard relayed no headers');
  const res = await p;
  assert.equal(res.headers['content-type'], RAW_STREAM);
  res.destroy();
});

// testcontainers' PostgreSqlContainer as this repo starts it (test-postgres-container.ts),
// serialised exactly as docker-modem's buildQuerystring does.
const TC_CREATE = querystring.stringify({
  Image: 'pgvector/pgvector:pg16',
  Cmd: ['postgres', '-c', 'shared_preload_libraries=pg_stat_statements', '-c', 'pg_stat_statements.track=all'],
  Env: ['POSTGRES_DB=raid_ledger_test', 'POSTGRES_USER=test', 'POSTGRES_PASSWORD=test'],
  Labels: JSON.stringify({ 'org.testcontainers': 'true', 'org.testcontainers.session-id': 'abc123' }),
  HostConfig: JSON.stringify({ PortBindings: { '5432/tcp': [{ HostPort: '' }] } }),
  ExposedPorts: JSON.stringify({ '5432/tcp': {} }),
});

test('testcontainers create: array fields copied into the query as repeated keys are accepted', () => {
  const p = classify('POST', `/containers/create?${TC_CREATE}`);
  assert.equal(p.ok, true, `testcontainers' create was refused: ${p.reason}`);
  assert.equal(classify('POST', '/v1.45/containers/create?Cmd=sh&Cmd=-c&Cmd=true&name=pg-1').ok, true);
});

test('a repeated key never lets a second value past a check: every value is validated', () => {
  const p = classify('POST', '/containers/create?name=pg-1&name=rl-runner-1');
  assert.equal(p.ok, false, 'a reserved name in the second name= value passed');
  // a single-value read of a repeated key fails closed (Go reads the first; never guess)
  const q = parseQuery('Cmd=a&Cmd=b');
  assert.deepEqual(q.getAll('Cmd'), ['a', 'b']);
  assert.throws(() => q.get('Cmd'), /query key Cmd is repeated/, 'a single-value read of a repeated key returned the first value');
  assert.throws(() => parseQuery('dockerfile=a&dockerfile=b'), /query key dockerfile is repeated/);
  assert.equal(classify('POST', '/build?dockerfile=Dockerfile&dockerfile=evil').ok, false);
  assert.equal(classify('POST', '/build?pull=0&pull=1').ok, false);
  assert.equal(classify('POST', '/images/create?fromImage=alpine&tag=3&tag=latest').ok, false);
});
