// ROK-1846 r3 MAJOR-B — the guard's caller identity must rest on something a
// runner cannot forge. Labels can be inherited from an image (a classic-builder
// RUN container of `FROM rl-infra/runner` + `LABEL rl.slot=2`); the compose
// container name rl-runner-N and compose's own labels cannot.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { classify } from '../src/routes.mjs';
import { checkContainerCreate } from '../src/body-policy.mjs';
import { runnerForAddress } from '../src/docker-client.mjs';

const compose = (n) => ({ 'com.docker.compose.project': 'rl-infra', 'com.docker.compose.service': `runner-${n}` });
const box = (name, labels, ip) => ({ Names: [`/${name}`], Labels: labels, NetworkSettings: { Networks: { g: { IPAddress: ip } } } });
const CONTAINERS = [
  box('rl-runner-1', { ...compose(1), 'rl.role': 'runner', 'rl.slot': '1' }, '10.9.0.2'),
  box('sharp_euclid', { 'rl.role': 'runner', 'rl.slot': '2' }, '10.9.0.9'),
  box('eager_hopper', { ...compose(2), 'rl.role': 'runner', 'rl.slot': '2' }, '10.9.0.10'),
  box('rl-runner-3', { 'rl.role': 'runner', 'rl.slot': '3' }, '10.9.0.11'),
  box('rl-runner-4', { ...compose(4), 'rl.role': 'runner', 'rl.slot': '2' }, '10.9.0.12'),
];
const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-id-')), 'd.sock');
const daemon = http.createServer((_req, res) => res.end(JSON.stringify(CONTAINERS)));
await new Promise((r) => daemon.listen(sock, r));
after(() => daemon.close());

test('the compose runner resolves to its slot', async () => {
  assert.deepEqual(await runnerForAddress(sock, '::ffff:10.9.0.2'), { owner: 'slot-1', slot: '1' });
});

test('forged rl.role=runner / rl.slot / compose labels do not resolve as a slot', async () => {
  assert.equal(await runnerForAddress(sock, '10.9.0.9'), null, 'labels only');
  assert.equal(await runnerForAddress(sock, '10.9.0.10'), null, 'compose labels, wrong name');
  assert.equal(await runnerForAddress(sock, '10.9.0.11'), null, 'right name, no compose labels');
  assert.equal(await runnerForAddress(sock, '10.9.0.12'), null, 'rl.slot disagrees with the name');
});

const ctx = { allow: [], owner: { owner: 'slot-2', slot: '2' } };
test('runner-created containers cannot carry compose or runner identity', () => {
  const mk = (Labels) => checkContainerCreate({ Image: 'x', Labels }, ctx);
  assert.equal(mk({ 'com.docker.compose.project': 'rl-infra' }).ok, false);
  assert.equal(mk({ 'com.docker.compose.service': 'runner-2' }).ok, false);
  assert.equal(mk({ 'rl.role': 'runner' }).ok, false);
  // Image-inherited compose labels are blanked; rl.slot stays the caller's.
  const out = mk({ 'rl.role': 'test-redis', 'rl.slot': '3' });
  assert.equal(out.body.Labels['com.docker.compose.project'], '');
  assert.equal(out.body.Labels['com.docker.compose.service'], '');
  assert.equal(out.body.Labels['rl.slot'], '2');
});

test('containers/create refuses infra, runner and env container names', () => {
  for (const n of ['rl-runner-3', '/rl-runner-1', 'rl-env-foo-allinone', 'rl-env-foo-pg', 'rl-gc-sweeper', 'rl-docker-guard', 'rl-traefik', 'rl-docker-proxy']) {
    assert.equal(classify('POST', `/containers/create?name=${encodeURIComponent(n)}`).ok, false, n);
  }
  for (const n of ['rl-test-redis-1-123', 'rl-ci-test-77', 'pg-tc-abc']) {
    assert.equal(classify('POST', `/containers/create?name=${n}`).ok, true, n);
  }
});
