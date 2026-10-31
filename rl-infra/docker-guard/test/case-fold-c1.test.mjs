// ROK-1846 c1 (Codex P2) — Go decodes JSON keys case-insensitively, so a body
// with `Container` AND `container` is checked on one and acted on by the other.
// Every checked field must be spelled exactly, once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBody, bodyOwnedContainer } from '../src/decide.mjs';
import { checkContainerCreate } from '../src/body-policy.mjs';

const ctx = { allow: [], owner: { owner: 'slot-2', slot: '2' } };

test('network connect refuses duplicate-by-case and mis-cased Container keys', () => {
  assert.equal(checkBody('network-connect', { Container: 'owned', container: 'victim' }, ctx).ok, false);
  assert.equal(checkBody('network-connect', { CONTAINER: 'victim' }, ctx).ok, false);
  assert.equal(checkBody('network-connect', { Container: 'owned', endpointconfig: {} }, ctx).ok, false);
  assert.equal(checkBody('network-connect', { Container: 'owned', EndpointConfig: {} }, ctx).ok, true);
  assert.equal(bodyOwnedContainer('network-connect', { Container: 'owned' }), 'owned');
});

test('container create refuses mis-cased Image / NetworkingConfig and duplicate Labels', () => {
  const mk = (b) => checkContainerCreate(b, ctx).ok;
  assert.equal(mk({ Image: 'alpine', image: 'rl-infra/orchestrator' }), false);
  assert.equal(mk({ Image: 'alpine', networkingconfig: {} }), false);
  assert.equal(mk({ Image: 'alpine', Labels: {}, labels: { 'rl.role': 'env' } }), false);
  assert.equal(mk({ Image: 'alpine', HostConfig: { NetworkMode: 'bridge', networkmode: 'host' } }), false);
  assert.equal(mk({ Image: 'alpine', NetworkingConfig: { EndpointsConfig: {} } }), true);
});
