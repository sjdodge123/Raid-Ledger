// ROK-1846 review R5:
//  M1 — a network-connect body's EndpointConfig keys were neither folded nor
//       allowlisted. Docker decodes `networkid` into NetworkID and prefers it
//       over the URL network, so a miscased key joined the guard network.
//  M2 — the guard resolved each network ref once but forwarded the original
//       string. Docker re-resolves a stored ref at start (full ID, exact name,
//       then ID prefix), so a network NAMED like the guard network's ID prefix
//       passes the check and, once deleted, the ref lands on the guard network.
//       Refs are now forwarded as the full IDs the guard checked, and hex-only
//       or docker-guard network names are refused at create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGuardServer } from '../src/guard.mjs';
import { checkNetworkCreate } from '../src/body-policy.mjs';

const OWNED = { 'rl.guard.owner': 'slot-2' };
const GUARD_ID = `f00dfeed${'a'.repeat(56)}`;
const OWN_ID = `c0ffee00${'b'.repeat(56)}`;
const NET_ID = 'd'.repeat(64);
const SHADOW_ID = `5ade0000${'e'.repeat(56)}`;
const BRIDGE_ID = `b41d9e00${'f'.repeat(56)}`;
const NETS = [
  { Name: 'rl-docker-guard', Id: GUARD_ID, Labels: {} },
  { Name: 'proj_default', Id: OWN_ID, Labels: OWNED },
  { Name: 'rl-net', Id: NET_ID, Labels: {} },
  // A runner-owned network NAMED like the guard network's ID prefix (pre-R5 create allowed it).
  { Name: GUARD_ID.slice(0, 12), Id: SHADOW_ID, Labels: OWNED },
  { Name: 'bridge', Id: BRIDGE_ID, Labels: {} },
];
const RUNNER = { Names: ['/rl-runner-2'], Labels: { 'com.docker.compose.service': 'runner-2', 'com.docker.compose.project': 'rl-infra' },
  NetworkSettings: { Networks: { guard: { IPAddress: '127.0.0.1' } } } };

/** Docker's FindNetwork: exact ID, exact name, then a unique ID prefix. */
function findNetwork(ref) {
  const exact = NETS.find((n) => n.Id === ref) ?? NETS.find((n) => n.Name === ref);
  if (exact) return exact;
  const hits = NETS.filter((n) => n.Id.startsWith(ref));
  return hits.length === 1 ? hits[0] : null;
}

function route(req, body, seen, res) {
  const url = req.url ?? '';
  if (url.startsWith('/containers/json')) return res.end(JSON.stringify([RUNNER]));
  if (url === '/containers/mine/json') return res.end(JSON.stringify({ Config: { Labels: OWNED } }));
  const get = /^\/networks\/([^/?]+)$/.exec(url);
  const found = get && req.method === 'GET' ? findNetwork(decodeURIComponent(get[1] ?? '')) : null;
  if (found) return res.end(JSON.stringify(found));
  if (/^(\/v[0-9.]+)?\/networks\/[^/]+\/connect$/.test(url) || url.startsWith('/containers/create')) {
    seen.push({ url, body: JSON.parse(body) });
    res.statusCode = url.startsWith('/containers/create') ? 201 : 200;
    return res.end('{"Id":"new"}');
  }
  res.statusCode = 404;
  return res.end('{"message":"no such object"}');
}

async function setup() {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-r5-')), 'd.sock');
  const seen = [];
  const daemon = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => route(req, Buffer.concat(chunks).toString('utf8'), seen, res));
  });
  await new Promise((r) => daemon.listen(sock, r));
  const guard = createGuardServer({ socket: sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  const { port } = guard.address();
  const close = () => { guard.closeAllConnections(); guard.close(); daemon.closeAllConnections(); daemon.close(); };
  return { port, seen, close };
}

function post(port, url, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: url,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(buf.length) } }, (res) => {
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

const CONNECT_REFUSED = [
  ['EndpointConfig.networkid = the guard ID', { networkid: GUARD_ID }, /key networkid must be spelled NetworkID/],
  ['EndpointConfig.NETWORKID = the guard ID', { NETWORKID: GUARD_ID }, /key NETWORKID must be spelled NetworkID/],
  ['EndpointConfig.NetworkId = the guard ID', { NetworkId: GUARD_ID }, /key NetworkId must be spelled NetworkID/],
  ['an EndpointConfig key off the allowlist (IPAMConfig)', { IPAMConfig: { IPv4Address: '10.9.0.5' } }, /EndpointConfig key IPAMConfig is not on the runner allowlist/],
  ['an EndpointConfig key off the allowlist (MacAddress)', { MacAddress: '02:42:ac:11:00:02' }, /EndpointConfig key MacAddress is not on the runner allowlist/],
  ['EndpointConfig.NetworkID = the guard ID', { NetworkID: GUARD_ID }, /resolves to rl-docker-guard/],
];

for (const [name, ep, why] of CONNECT_REFUSED) {
  test(`R5 M1: connect with ${name} is refused 403 and never forwarded`, () => withGuard(async (g) => {
    const r = await post(g.port, '/v1.43/networks/proj_default/connect', { Container: 'mine', EndpointConfig: ep });
    assert.equal(r.status, 403, `expected 403, got ${r.status}: ${r.text}`);
    assert.match(r.text, why);
    assert.deepEqual(g.seen, [], 'the connect reached the daemon');
  }));
}

test('R5 m2: connect to a guard-ID prefix in the URL is refused', () => withGuard(async (g) => {
  const r = await post(g.port, `/networks/${GUARD_ID.slice(0, 16)}/connect`, { Container: 'mine', EndpointConfig: {} });
  assert.equal(r.status, 403, `expected 403, got ${r.status}: ${r.text}`);
  assert.deepEqual(g.seen, [], 'the connect reached the daemon');
}));

test('R5 M2: connect by name is forwarded to the full ID with its endpoint settings intact', () => withGuard(async (g) => {
  const r = await post(g.port, '/v1.43/networks/proj_default/connect', { Container: 'mine', EndpointConfig: { Aliases: ['db'], NetworkID: 'proj_default' } });
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.deepEqual(g.seen, [{ url: `/v1.43/networks/${OWN_ID}/connect`, body: { Container: 'mine', EndpointConfig: { Aliases: ['db'], NetworkID: OWN_ID } } }]);
}));

test('R5 M2: create forwards every network ref as the full ID the guard checked', () => withGuard(async (g) => {
  const r = await post(g.port, '/containers/create', { Image: 'alpine', HostConfig: { NetworkMode: 'proj_default' },
    NetworkingConfig: { EndpointsConfig: { proj_default: { Aliases: ['db'] }, 'rl-net': { Aliases: ['redis'], NetworkID: 'rl-net' } } } });
  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${r.text}`);
  const sent = g.seen[0]?.body;
  assert.equal(sent?.HostConfig?.NetworkMode, OWN_ID);
  assert.deepEqual(sent?.NetworkingConfig, { EndpointsConfig: { [OWN_ID]: { Aliases: ['db'] }, [NET_ID]: { Aliases: ['redis'], NetworkID: NET_ID } } });
}));

test('R5 M2: a name shadowing a guard-ID prefix is pinned to the shadow network, so a later delete cannot redirect it', () => withGuard(async (g) => {
  const r = await post(g.port, '/containers/create', { Image: 'alpine', HostConfig: { NetworkMode: GUARD_ID.slice(0, 12) } });
  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${r.text}`);
  assert.equal(g.seen[0]?.body?.HostConfig?.NetworkMode, SHADOW_ID, 'the forwarded ref is still the re-resolvable name');
}));

test('R5 M2: the predefined bridge network stays spelled bridge', () => withGuard(async (g) => {
  const r = await post(g.port, '/containers/create', { Image: 'alpine', HostConfig: { NetworkMode: 'bridge' } });
  assert.equal(r.status, 201, `expected 201, got ${r.status}: ${r.text}`);
  assert.equal(g.seen[0]?.body?.HostConfig?.NetworkMode, 'bridge');
}));

test('R5 M2: two endpoints naming the same network are refused', () => withGuard(async (g) => {
  const r = await post(g.port, '/containers/create', { Image: 'alpine', NetworkingConfig: { EndpointsConfig: { proj_default: {}, [OWN_ID.slice(0, 12)]: {} } } });
  assert.equal(r.status, 403, `expected 403, got ${r.status}: ${r.text}`);
  assert.match(r.text, /two endpoints name network/);
  assert.deepEqual(g.seen, []);
}));

const OWNER = { owner: 'slot-2', slot: '2' };

test('R5 M2: network create refuses hex-only and docker-guard names, and a miscased Name', () => {
  for (const Name of [GUARD_ID.slice(0, 12), GUARD_ID, 'ABCDEF', '0', 'x-docker-guard', 'Docker-Guard2']) {
    const v = checkNetworkCreate({ Name }, { owner: OWNER });
    assert.equal(v.ok, false, `network name ${Name} was allowed`);
    assert.match(v.reason, /is all hex|is reserved for the guard/);
  }
  const twice = checkNetworkCreate({ Name: 'x', name: GUARD_ID.slice(0, 12) }, { owner: OWNER });
  assert.equal(twice.ok, false, 'a second, miscased name key was allowed');
  assert.match(twice.reason, /key name must be spelled Name/);
});

test('R5 M2: normal runner network names are still created', () => {
  for (const Name of ['proj_default', 'rl-net-test', '3f2a9c1e-77b0-4d5e-9a1b-2c3d4e5f6a7b', 'cafe_net']) {
    const v = checkNetworkCreate({ Name }, { owner: OWNER });
    assert.equal(v.ok, true, `network name ${Name} was refused: ${v.reason}`);
  }
});
