// ROK-1846 — unit tests for the guard's route table and body checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/routes.mjs';
import { checkContainerCreate, hostPathAllowed, OWNER_LABEL, parseBindAllow } from '../src/body-policy.mjs';

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
  assert.equal(classify('POST', '/grpc', { allowBuildkit: true }).ok, true, 'BuildKit only behind the switch');
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
