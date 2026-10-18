// ROK-1846 r3 MAJOR-A — a runner must not write a local image tag an infra
// service (or another env's default) runs from: compose's pull_policy:missing
// would start the attacker's image with the raw socket on the next recreate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/routes.mjs';

const ok = (m, u) => classify(m, u).ok;

test('tag: only the runner image namespaces may be written', () => {
  for (const [repo, tag] of [
    ['rl-infra/gc-sweeper', 'latest'], ['rl-infra/docker-guard', ''], ['wollomatic/socket-proxy', '1'],
    ['traefik', 'v3.4'], ['docker.io/library/traefik', 'v3.4'], ['registry', '2'], ['grafana/loki', '3.2.0'],
    ['rl-infra/runner', 'latest'], ['rl-infra/dashboard', 'latest'], ['postgres', '16-alpine'], ['redis', '7'],
    ['registry.rl.lan:5000/rl-allinone', 'latest'], ['registry.rl.lan:5000/rl-allinone', ''],
    ['registry.rl.lan:5000/rl-allinone:latest', ''], ['alpine', ''], ['Rl', 'x'],
  ]) assert.equal(ok('POST', `/v1.45/images/alpine/tag?repo=${encodeURIComponent(repo)}&tag=${tag}`), false, `${repo}:${tag}`);
  assert.equal(ok('POST', '/images/alpine/tag'), false, 'no repo');
  assert.equal(ok('POST', '/images/abc123/tag?repo=registry.rl.lan:5000/rl-allinone&tag=rok-1846'), true);
  assert.equal(ok('POST', '/images/abc123/tag?repo=rl&tag=ci-test'), true);
});

test('build t=: every tag, including the repeated form, must be allowed', () => {
  assert.equal(ok('POST', '/v1.45/build?t=registry.rl.lan:5000/rl-allinone:rok-1846'), true);
  assert.equal(ok('POST', '/build?t=rl:ci-test'), true);
  assert.equal(ok('POST', '/build'), true, 'untagged build');
  assert.equal(ok('POST', '/build?t=rl-infra/gc-sweeper:latest'), false);
  assert.equal(ok('POST', '/build?t=rl:ci-test&t=traefik:v3.4'), false, 'repeated t=');
  assert.equal(ok('POST', '/build?t=registry.rl.lan:5000/rl-allinone'), false, 'implicit :latest');
  assert.equal(ok('POST', '/build?t=registry.rl.lan:5000/rl-allinone:latest'), false);
});

test('build networkmode: only the default bridge or none', () => {
  assert.equal(ok('POST', '/build?networkmode=rl-docker-guard'), false);
  assert.equal(ok('POST', '/build?networkmode=rl-net'), false);
  for (const m of ['', 'default', 'bridge', 'none']) assert.equal(ok('POST', `/build?networkmode=${m}`), true, m);
});

test('images/create: a pull never lands on an infra service name', () => {
  for (const q of [
    'fromImage=rl-infra/gc-sweeper', 'fromImage=rl-infra/docker-guard&tag=latest', 'fromImage=docker.io/rl-infra/runner:latest',
    'fromImage=wollomatic/socket-proxy&tag=1', 'fromImage=traefik:v3.4', 'fromImage=registry&tag=2',
    'fromImage=grafana/grafana&tag=11.2.0', 'fromImage=rl&tag=ci-test', 'repo=rl-infra/dashboard&fromImage=x',
    'fromImage=index.docker.io/library/traefik', 'fromImage=redis&repo=traefik',
  ]) assert.equal(ok('POST', `/images/create?${q}`), false, q);
  assert.equal(ok('POST', '/images/create?fromImage=redis&tag=7-alpine'), true);
  assert.equal(ok('POST', '/images/create?fromImage=postgres:16-alpine'), true);
  assert.equal(ok('POST', '/images/create?fromImage=registry.rl.lan:5000/rl-allinone&tag=latest'), true, 'pull from our registry');
  assert.equal(ok('POST', '/images/create'), false, 'no fromImage');
});

test('push: only the runner image namespaces', () => {
  assert.equal(ok('POST', '/images/registry.rl.lan:5000/rl-allinone/push?tag=rok-1846'), true);
  assert.equal(ok('POST', '/images/registry.rl.lan:5000/rl-allinone/push?tag=latest'), false);
  assert.equal(ok('POST', '/images/registry.rl.lan:5000/rl-infra/runner/push?tag=x'), false);
});
