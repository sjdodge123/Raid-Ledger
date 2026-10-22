// ROK-1846 c6 (Codex r6 P1-2) — a runner could pre-create `rl-data-<victim>`
// (explicitly, or implicitly via a named-volume mount the guard pre-creates
// owner-stamped) before env-spin mounted it as that env's PostgreSQL data dir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkVolumeCreate } from '../src/body-policy.mjs';
import { startGuard, call } from './guard-c6-helpers.mjs';

const OWNER = { owner: 'slot-2', slot: '2' };
let g;
before(async () => { g = await startGuard(); });
after(() => g.close());

test('volumes/create of a reserved name is refused', () => {
  for (const Name of ['rl-data-victim', 'rl-data-rok-1', 'rl-infra_traefik-acme', 'rl-infra_runner-1-cache']) {
    const v = checkVolumeCreate({ Name }, { owner: OWNER });
    assert.equal(v.ok, false, `${Name} accepted`);
    assert.match(v.reason, /reserved/);
  }
  assert.equal(checkVolumeCreate({ Name: 'tc-cache' }, { owner: OWNER }).ok, true, 'ordinary name still allowed');
});

test('POST /volumes/create rl-data-victim never reaches the daemon', async () => {
  const r = await call(g.port, 'POST', '/volumes/create', { Name: 'rl-data-victim' });
  assert.equal(r.status, 403, r.body);
  assert.equal(g.daemon.seen.some((s) => s.url.startsWith('/volumes/create')), false, 'forwarded');
});

test('a container mounting rl-data-victim by name is refused before the guard pre-creates it', async () => {
  for (const HostConfig of [{ Binds: ['rl-data-victim:/data'] }, { Mounts: [{ Type: 'volume', Source: 'rl-data-victim', Target: '/data' }] }]) {
    const r = await call(g.port, 'POST', '/containers/create', { Image: 'docker.io/library/redis:7', HostConfig });
    assert.equal(r.status, 403, r.body);
    assert.match(r.body, /volume name rl-data-victim is reserved/);
  }
  assert.equal(g.daemon.seen.some((s) => s.url.startsWith('/volumes/') || s.url.startsWith('/containers/create')), false);
});
