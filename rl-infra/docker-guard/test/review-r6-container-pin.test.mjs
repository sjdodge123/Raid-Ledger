// ROK-1846 review R6:
//  M — container refs were owner-checked by one daemon lookup and forwarded as
//      spelled. Docker resolves a container ref by full ID, exact name, then a
//      unique ID prefix, so a runner container NAMED like a victim's ID prefix
//      passes the check and, once deleted, the forwarded ref lands on the
//      victim. Every owner-checked container / network ref is now forwarded as
//      the full ID the check saw (ref-pin.mjs), the network-connect body's
//      `Container` included, and hex-only container names are refused at create.
//  m — the (dis)connect URL network is owner-checked again by the ID the
//      network-ref resolution pinned (guard.mjs pinNetworks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGuardServer } from '../src/guard.mjs';
import { classify } from '../src/routes.mjs';

const MINE = { 'rl.guard.owner': 'slot-2' };
const THEIRS = { 'rl.guard.owner': 'slot-1' };
const VICTIM_ID = `abcdef12${'1'.repeat(56)}`;
const SHADOW_ID = `5ade0000${'2'.repeat(56)}`;
const OWN_ID = `c0ffee00${'3'.repeat(56)}`;
const CONTAINERS = [
  { Id: VICTIM_ID, Name: '/victim', Config: { Labels: THEIRS } },
  // A slot-2 container NAMED like the victim's ID prefix (pre-R6 create allowed it).
  { Id: SHADOW_ID, Name: `/${VICTIM_ID.slice(0, 12)}`, Config: { Labels: MINE } },
  { Id: OWN_ID, Name: '/mine', Config: { Labels: MINE } },
];
const NET_A = `aaaa0000${'4'.repeat(56)}`;
const NET_B = `bbbb0000${'5'.repeat(56)}`;
const NETS = [
  { Id: NET_A, Name: 'proj_default', Labels: MINE },
  { Id: NET_B, Name: 'other_default', Labels: THEIRS },
];
const RUNNER = { Names: ['/rl-runner-2'], Labels: { 'com.docker.compose.service': 'runner-2', 'com.docker.compose.project': 'rl-infra' },
  NetworkSettings: { Networks: { guard: { IPAddress: '127.0.0.1' } } } };

/** Docker's lookup order: exact ID, exact name, then a unique ID prefix. */
function find(list, ref, name) {
  const exact = list.find((o) => o.Id === ref) ?? list.find((o) => name(o) === ref);
  if (exact) return exact;
  const hits = list.filter((o) => o.Id.startsWith(ref));
  return hits.length === 1 ? hits[0] : null;
}

function lookup(url, flips) {
  const c = /^\/containers\/([^/?]+)\/json$/.exec(url);
  if (c) return find(CONTAINERS, decodeURIComponent(c[1] ?? ''), (o) => o.Name.slice(1));
  const n = /^\/networks\/([^/?]+)$/.exec(url);
  if (!n) return null;
  const ref = decodeURIComponent(n[1] ?? '');
  // `flip` names proj_default on the first lookup and other_default after it.
  if (ref === 'flip') return flips.n++ === 0 ? NETS[0] : NETS[1];
  return find(NETS, ref, (o) => o.Name);
}

async function setup() {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-r6-')), 'd.sock');
  const seen = [];
  const flips = { n: 0 };
  const daemon = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (ch) => chunks.push(ch));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.startsWith('/containers/json')) return res.end(JSON.stringify([RUNNER]));
      const found = req.method === 'GET' ? lookup(url, flips) : null;
      if (found) return res.end(JSON.stringify(found));
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method, url, body: body ? JSON.parse(body) : undefined });
      res.statusCode = 200;
      return res.end('{}');
    });
  });
  await new Promise((r) => daemon.listen(sock, r));
  const guard = createGuardServer({ socket: sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  const { port } = guard.address();
  const close = () => { guard.closeAllConnections(); guard.close(); daemon.closeAllConnections(); daemon.close(); };
  return { port, seen, close };
}

function send(port, method, url, body) {
  return new Promise((resolve, reject) => {
    const buf = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const headers = body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) };
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(buf);
  });
}

async function withGuard(fn) {
  const g = await setup();
  try {
    await fn(g);
  } finally {
    g.close();
  }
}

const SHADOW_REF = VICTIM_ID.slice(0, 12);
const ROUTES = [
  ['GET', 'json', ''], ['GET', 'logs', '?stdout=1'], ['GET', 'archive', '?path=/x'], ['PUT', 'archive', '?path=/x'],
  ['POST', 'start', ''], ['POST', 'stop', ''], ['POST', 'kill', ''], ['POST', 'wait', ''], ['DELETE', '', '?force=1'],
];

for (const [method, verb, query] of ROUTES) {
  const tail = verb ? `/${verb}` : '';
  test(`R6 M: ${method} /containers/{ref}${tail} is forwarded as the full ID the owner check saw`, () => withGuard(async (g) => {
    const r = await send(g.port, method, `/v1.45/containers/${SHADOW_REF}${tail}${query}`);
    assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
    assert.deepEqual(g.seen.map((s) => s.url), [`/v1.45/containers/${SHADOW_ID}${tail}${query}`],
      'the forwarded path still carries the re-resolvable ref (it would land on the victim once the shadow is deleted)');
  }));
}

test('R6 M: an exec create on a named container is forwarded to its full ID', () => withGuard(async (g) => {
  const r = await send(g.port, 'POST', '/containers/mine/exec', { Cmd: ['true'] });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.equal(g.seen[0]?.url, `/containers/${OWN_ID}/exec`, 'exec create forwarded the container ref as spelled');
}));

test('R6 M: the victim itself is still refused by ID prefix and by name', () => withGuard(async (g) => {
  for (const ref of [VICTIM_ID.slice(0, 16), 'victim']) {
    const r = await send(g.port, 'GET', `/containers/${ref}/json`);
    assert.equal(r.status, 403, `expected 403 for ${ref}, got ${r.status}: ${r.text}`);
  }
  assert.deepEqual(g.seen, []);
}));

test('R6 M: a network-connect body Container is forwarded as the full ID', () => withGuard(async (g) => {
  const r = await send(g.port, 'POST', '/networks/proj_default/connect', { Container: SHADOW_REF, EndpointConfig: {} });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.deepEqual(g.seen, [{ method: 'POST', url: `/networks/${NET_A}/connect`, body: { Container: SHADOW_ID, EndpointConfig: {} } }],
    'the connect body still names the re-resolvable container ref');
}));

test('R6 M: DELETE /networks/{name} is forwarded as the full ID', () => withGuard(async (g) => {
  const r = await send(g.port, 'DELETE', '/networks/proj_default');
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.deepEqual(g.seen.map((s) => s.url), [`/networks/${NET_A}`], 'network delete forwarded the ref as spelled');
}));

test('R6 m: a connect whose URL network re-resolves to another slot\'s network is refused', () => withGuard(async (g) => {
  const r = await send(g.port, 'POST', '/networks/flip/connect', { Container: 'mine', EndpointConfig: {} });
  assert.equal(r.status, 403, `expected 403, got ${r.status}: ${r.text}`);
  assert.match(r.text, /network flip is not owned by slot-2/);
  assert.deepEqual(g.seen, [], 'the connect reached the daemon on a network the caller does not own');
}));

test('R6 M: container create refuses hex-only names', () => {
  for (const name of [SHADOW_REF, VICTIM_ID, `/${SHADOW_REF}`, 'ABCDEF', '0', 'cafe']) {
    const plan = classify('POST', `/v1.45/containers/create?name=${encodeURIComponent(name).replace(/%2F/g, '/')}`);
    assert.equal(plan.ok, false, `container name ${name} was allowed`);
    assert.match(plan.reason, /is all hex \(it could shadow a container ID\)/);
  }
});

test('R6 M: normal container names are still created', () => {
  for (const name of ['mine', 'proj-db-1', 'cafe_1', 'rl-ci-postgres', 'testcontainers-ryuk-x', 'gnome']) {
    const plan = classify('POST', `/v1.45/containers/create?name=${name}`);
    assert.equal(plan.ok, true, `container name ${name} was refused: ${plan.reason}`);
  }
  assert.equal(classify('POST', '/v1.45/containers/create').ok, true, 'an unnamed create was refused');
});
