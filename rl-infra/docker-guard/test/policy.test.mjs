// ROK-1846 — unit tests for the guard's route table and body checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/routes.mjs';
import { checkContainerCreate, checkNetworkCreate, checkVolumeCreate, hostPathAllowed, OWNER_LABEL, parseBindAllow } from '../src/body-policy.mjs';

const owner = { owner: 'slot-2', slot: '2' };

test('exec / kill / rm / archive on an existing container require ownership', () => {
  for (const [m, u] of [
    ['POST', '/v1.45/containers/rl-gc-sweeper/exec'],
    ['POST', '/containers/abc123/kill'],
    ['DELETE', '/v1.45/containers/rl-env-x-allinone?force=1'],
    ['PUT', '/containers/rl-traefik/archive?path=/etc'],
    ['GET', '/containers/rl-traefik/export'],
    ['GET', '/v1.45/containers/rl-env-x-allinone/json'],
    ['GET', '/containers/rl-env-x-allinone/logs?follow=1'],
  ]) {
    const plan = classify(m, u);
    assert.equal(plan.ok, true, `${m} ${u}`);
    assert.equal(plan.owned?.kind, 'container', `${m} ${u} needs an owned container`);
  }
  assert.equal(classify('POST', '/containers/rl-gc-sweeper/exec').owned?.id, 'rl-gc-sweeper');
});

test('unknown and dangerous endpoints are refused', () => {
  for (const [m, u] of [
    ['POST', '/plugins/pull'], ['POST', '/swarm/init'], ['POST', '/containers/x/update'],
    ['POST', '/commit?container=rl-traefik'], ['POST', '/containers/prune'], ['POST', '/grpc'],
  ]) assert.equal(classify(m, u).ok, false, `${m} ${u}`);
  // c8: the switch never opens BuildKit (its upgrades are not proxied) — it is an explicit 400.
  const bk = classify('POST', '/grpc', { allowBuildkit: true });
  assert.equal(bk.ok, false, 'BuildKit stays closed even behind the switch');
  assert.match(bk.reason ?? '', /^buildkit_session_unsupported/);
});

test('read-only listing stays open without ownership', () => {
  const plan = classify('GET', '/v1.45/containers/json?all=1');
  assert.deepEqual(plan, { ok: true });
});

test('create stamps the calling slot and overwrites a forged owner label', () => {
  const v = checkContainerCreate({ Image: 'alpine', Labels: { [OWNER_LABEL]: 'slot-1', 'rl.slot': '1' } }, { allow: [], owner });
  assert.equal(v.ok, true);
  assert.equal(v.body.Labels[OWNER_LABEL], 'slot-2');
  assert.equal(v.body.Labels['rl.slot'], '2');
});

test('bind allowlist is prefix-safe and rejects traversal', () => {
  const allow = parseBindAllow('/srv/rl-infra/runners:/tmp/ok');
  assert.equal(hostPathAllowed('/srv/rl-infra/runners/slot-1/worktree', allow), true);
  assert.equal(hostPathAllowed('/srv/rl-infra/runners-evil', allow), false);
  assert.equal(hostPathAllowed('/srv/rl-infra/runners/../.env', allow), false);
  assert.equal(hostPathAllowed('/', allow), false);
  assert.deepEqual(parseBindAllow(''), []);
  const denied = checkContainerCreate({ HostConfig: { Binds: ['/srv/rl-infra/.env:/x:ro'] } }, { allow, owner });
  assert.equal(denied.ok, false);
});

// PROOF-1681-r2 row 18: `docker compose up` on a runner. Compose stamps these
// labels on every container, network and volume it creates.
const composeLabels = (project) => ({
  'com.docker.compose.project': project, 'com.docker.compose.service': 'r', 'com.docker.compose.container-number': '1',
  'com.docker.compose.config-hash': 'a1b2c3', 'com.docker.compose.oneoff': 'False', 'com.docker.compose.version': '5.6.1',
  'com.docker.compose.project.config_files': '/workspace/compose.yml', 'com.docker.compose.project.working_dir': '/workspace',
  'com.docker.compose.depends_on': '', 'com.docker.compose.image': 'sha256:abc',
});
const composeCreate = (project) => ({
  Image: 'redis:7-alpine', Labels: composeLabels(project),
  Healthcheck: { Test: ['CMD', 'redis-cli', 'ping'], Interval: 1000000000 },
  HostConfig: { NetworkMode: `${project}_default`, RestartPolicy: { Name: '' } },
  NetworkingConfig: { EndpointsConfig: { [`${project}_default`]: { Aliases: ['r', `${project}-r-1`] } } },
});

test('a runner may create its own compose project (container, network, volume)', () => {
  const c = checkContainerCreate(composeCreate('proof1681c'), { allow: [], owner });
  assert.equal(c.ok, true, `container: ${c.reason}`);
  assert.equal(c.body.Labels['com.docker.compose.project'], 'proof1681c', 'compose finds its containers by project');
  assert.equal(c.body.Labels['com.docker.compose.service'], 'r');
  assert.equal(c.body.Labels['com.docker.compose.config-hash'], 'a1b2c3');
  assert.equal(c.body.Labels[OWNER_LABEL], 'slot-2');
  const n = checkNetworkCreate({ Name: 'proof1681c_default', Labels: { ...composeLabels('proof1681c'), 'com.docker.compose.network': 'default' } }, { owner });
  assert.equal(n.ok, true, `network: ${n.reason}`);
  const v = checkVolumeCreate({ Name: 'proof1681c_data', Labels: { ...composeLabels('proof1681c'), 'com.docker.compose.volume': 'data' } }, { owner });
  assert.equal(v.ok, true, `volume: ${v.reason}`);
});

test('no runner-created resource may join the infra compose project', () => {
  for (const project of ['rl-infra', 'RL-Infra', ' rl-infra', 'rl-infra-x']) {
    const n = checkNetworkCreate({ Name: 'x', Labels: composeLabels(project) }, { owner });
    assert.match(String(n.reason), /compose project .* is reserved for the fleet infra/, `network ${project}`);
    const c = checkContainerCreate(composeCreate(project), { allow: [], owner });
    assert.match(String(c.reason), /compose project .* is reserved for the fleet infra/, `container ${project}`);
    const v = checkVolumeCreate({ Name: 'x', Labels: composeLabels(project) }, { owner });
    assert.match(String(v.reason), /compose project .* is reserved for the fleet infra/, `volume ${project}`);
  }
  // A compose label without a project cannot borrow the image's (or infra's).
  const bare = checkContainerCreate({ Image: 'x', Labels: { 'com.docker.compose.service': 'runner-2' } }, { allow: [], owner });
  assert.match(String(bare.reason), /need a non-empty com.docker.compose.project/);
});
