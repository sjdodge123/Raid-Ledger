// ROK-1846 Codex r11:
//  P2 — the forbidden-network check matched NAMES only. GET /networks is
//       allowed, so a runner reads the guard network's ID and names it in hex
//       (full, or a unique prefix — Docker's FindNetwork accepts both) in
//       NetworkMode, an EndpointsConfig key or an endpoint NetworkID. The guard
//       now resolves every reference through the daemon and refuses by the
//       resolved name; an unresolvable reference is refused.
//  P1 — the guard names its caller by source IP on a shared bridge; a child
//       with CAP_NET_RAW could ARP-spoof. Every child create drops NET_RAW.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createGuardServer } from '../src/guard.mjs';
import { checkContainerCreate } from '../src/body-policy.mjs';

const GUARD_ID = `f00dfeed${'a'.repeat(56)}`;
const OWN_ID = `c0ffee00${'b'.repeat(56)}`;
const NETS = [{ Name: 'rl-docker-guard', Id: GUARD_ID }, { Name: 'proj_default', Id: OWN_ID }, { Name: 'rl-net', Id: 'd'.repeat(64) }];
const RUNNER = { Names: ['/rl-runner-2'], Labels: { 'com.docker.compose.service': 'runner-2', 'com.docker.compose.project': 'rl-infra' },
  NetworkSettings: { Networks: { guard: { IPAddress: '127.0.0.1' } } } };

/** Docker's FindNetwork: exact ID, exact name, then a unique ID prefix. */
function findNetwork(ref) {
  const exact = NETS.find((n) => n.Id === ref || n.Name === ref);
  if (exact) return exact;
  const hits = NETS.filter((n) => n.Id.startsWith(ref));
  return hits.length === 1 ? hits[0] : null;
}

async function setup() {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-r11-')), 'd.sock');
  const created = [];
  const daemon = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (url.startsWith('/containers/json')) return res.end(JSON.stringify([RUNNER]));
      const net = /^\/networks\/([^/?]+)$/.exec(url);
      const found = net ? findNetwork(decodeURIComponent(net[1] ?? '')) : null;
      if (found) return res.end(JSON.stringify({ ...found, Labels: {} }));
      if (url.startsWith('/containers/create')) {
        created.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.statusCode = 201;
        return res.end('{"Id":"new"}');
      }
      res.statusCode = 404;
      res.end('{"message":"no such object"}');
    });
  });
  await new Promise((r) => daemon.listen(sock, r));
  const guard = createGuardServer({ socket: sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  const { port } = guard.address();
  const close = () => { guard.closeAllConnections(); guard.close(); daemon.closeAllConnections(); daemon.close(); };
  return { port, created, close };
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

const REFUSED = [
  ['NetworkMode = the guard network full ID', { HostConfig: { NetworkMode: GUARD_ID } }],
  ['NetworkMode = a 12-char prefix of the guard network ID', { HostConfig: { NetworkMode: GUARD_ID.slice(0, 12) } }],
  ['EndpointsConfig key = the guard network full ID', { NetworkingConfig: { EndpointsConfig: { [GUARD_ID]: {} } } }],
  ['EndpointsConfig key = a 12-char prefix', { NetworkingConfig: { EndpointsConfig: { [GUARD_ID.slice(0, 12)]: {} } } }],
  ['an endpoint NetworkID = the guard network ID', { NetworkingConfig: { EndpointsConfig: { 'rl-net': { NetworkID: GUARD_ID } } } }],
  ['a network the daemon cannot resolve (fail closed)', { HostConfig: { NetworkMode: 'nonexistent-net' } }],
];

for (const [name, extra] of REFUSED) {
  test(`r11 P2: ${name} is refused 403 and never created`, async () => {
    const g = await setup();
    try {
      const r = await post(g.port, '/containers/create', { Image: 'alpine', ...extra });
      assert.equal(r.status, 403, `expected 403, got ${r.status}: ${r.text}`);
      assert.match(r.text, /network .* (resolves to rl-docker-guard|could not be resolved)/);
      assert.equal(g.created.length, 0, 'the create reached the daemon');
    } finally {
      g.close();
    }
  });
}

test('r11 P2: a normal network by full ID, prefix and name is forwarded', async () => {
  const g = await setup();
  try {
    const body = { Image: 'alpine', HostConfig: { NetworkMode: OWN_ID },
      NetworkingConfig: { EndpointsConfig: { [OWN_ID.slice(0, 12)]: { NetworkID: OWN_ID }, 'rl-net': { Aliases: ['redis'] } } } };
    const r = await post(g.port, '/containers/create', body);
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${r.text}`);
    assert.equal(g.created.length, 1);
  } finally {
    g.close();
  }
});

test('r11 P1: a create without CapDrop is forwarded with NET_RAW dropped', async () => {
  const g = await setup();
  try {
    const r = await post(g.port, '/containers/create', { Image: 'alpine', HostConfig: { NetworkMode: 'rl-net' } });
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${r.text}`);
    assert.deepEqual(g.created[0]?.HostConfig?.CapDrop, ['NET_RAW']);
    assert.equal(g.created[0]?.HostConfig?.NetworkMode, 'rl-net');
  } finally {
    g.close();
  }
});

const OWNER = { owner: 'slot-2', slot: '2' };
const capDropOf = (hc) => {
  const v = checkContainerCreate({ Image: 'alpine', ...(hc === undefined ? {} : { HostConfig: hc }) }, { allow: [], owner: OWNER });
  assert.equal(v.ok, true, `refused: ${v.reason}`);
  return v.body.HostConfig.CapDrop;
};

test('r11 P1: CapDrop always ends up dropping NET_RAW (or ALL)', () => {
  assert.deepEqual(capDropOf(undefined), ['NET_RAW']);
  assert.deepEqual(capDropOf({ CapDrop: null }), ['NET_RAW']);
  assert.deepEqual(capDropOf({ CapDrop: ['MKNOD'] }), ['MKNOD', 'NET_RAW']);
  assert.deepEqual(capDropOf({ CapDrop: 'MKNOD' }), ['MKNOD', 'NET_RAW']);
  assert.deepEqual(capDropOf({ CapDrop: ['ALL'] }), ['ALL']);
  assert.deepEqual(capDropOf({ CapDrop: ['cap_net_raw'] }), ['cap_net_raw']);
});

test('r11 P1: CapAdd NET_RAW / NET_ADMIN, a non-list CapDrop and a non-object HostConfig are refused', () => {
  for (const cap of ['NET_RAW', 'NET_ADMIN', 'CAP_NET_RAW']) {
    const v = checkContainerCreate({ Image: 'alpine', HostConfig: { CapAdd: [cap] } }, { allow: [], owner: OWNER });
    assert.equal(v.ok, false, `CapAdd ${cap} was allowed`);
    assert.match(v.reason, /HostConfig.CapAdd is not on the runner allowlist|CapAdd is not allowed/);
  }
  const bad = checkContainerCreate({ Image: 'alpine', HostConfig: { CapDrop: [1] } }, { allow: [], owner: OWNER });
  assert.equal(bad.ok, false, 'CapDrop [1] was allowed');
  assert.match(bad.reason, /CapDrop is not a list of strings/);
  const str = checkContainerCreate({ Image: 'alpine', HostConfig: 'x' }, { allow: [], owner: OWNER });
  assert.equal(str.ok, false, 'HostConfig "x" was allowed');
  assert.match(str.reason, /HostConfig is not an object/);
});
