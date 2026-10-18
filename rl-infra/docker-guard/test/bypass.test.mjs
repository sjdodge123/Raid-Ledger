// ROK-1846 — the guard must refuse what Docker would honour, not just what the
// guard's own parser sees: Go's case-insensitive JSON field matching, legacy
// links, daemon-side URL fetches, non-canonical paths, and named volumes that
// already belong to someone else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { classify } from '../src/routes.mjs';
import { checkContainerCreate, checkExecCreate, OWNER_LABEL } from '../src/body-policy.mjs';
import { namedVolumeRefs } from '../src/volume-refs.mjs';
import { ensureOwnedVolume } from '../src/docker-client.mjs';

const ctx = { allow: [], owner: { owner: 'slot-2', slot: '2' } };
const create = (hc, extra = {}) => checkContainerCreate({ Image: 'alpine', HostConfig: hc, ...extra }, ctx);

test('case and unicode spellings Docker would decode are refused', () => {
  assert.equal(create({ privileged: true }).ok, false);
  assert.equal(create({ Privileged: false, PRIVILEGED: true }).ok, false);
  assert.equal(create({ 'Bind\u017f': ['/:/host'] }).ok, false);
  assert.equal(checkContainerCreate({ Image: 'alpine', hostconfig: { Privileged: true } }, ctx).ok, false);
  assert.equal(create({ Mounts: [{ type: 'bind', Source: '/', Target: '/h' }] }).ok, false);
  assert.equal(checkExecCreate({ Cmd: ['sh'], privileged: true }).ok, false);
  // Unrelated keys keep working; label keys are free-form.
  assert.equal(create({ AutoRemove: true }, { Labels: { 'org.testcontainers': 'true' } }).ok, true);
});

test('links, cgroup join and plugin volume drivers are refused', () => {
  assert.equal(create({ Links: ['rl-gc-sweeper:s'] }).ok, false);
  assert.equal(create({ Cgroup: 'container:rl-traefik' }).ok, false);
  assert.equal(create({ VolumeDriver: 'evil' }).ok, false);
  assert.equal(create({ VolumeDriver: 'local' }).ok, true);
});

test('daemon-side URL fetches and non-canonical paths are refused', () => {
  assert.equal(classify('POST', '/v1.45/build?remote=http://127.0.0.1:2375/info').ok, false);
  assert.equal(classify('POST', '/build?networkmode=default&networkmode=host').ok, false);
  assert.equal(classify('POST', '/images/create?fromSrc=http://127.0.0.1:2375/info').ok, false);
  assert.equal(classify('POST', '/images/create?fromImage=redis&tag=7').ok, true);
  for (const u of ['/containers/x/json/../../create', '/containers%2Fcreate', '//containers/json', '/containers\\create']) {
    assert.equal(classify('POST', u).ok, false, u);
  }
});

test('namedVolumeRefs finds Binds and volume Mounts, skips host paths and tmpfs', () => {
  const refs = namedVolumeRefs({ HostConfig: {
    Binds: ['rl-data-victim:/data', '/srv/x:/x', 'cache:/c:ro'],
    Mounts: [{ Type: 'volume', Source: 'traefik-acme', Target: '/a' }, { Type: 'tmpfs', Target: '/t' }, { Type: 'volume', Target: '/anon' }],
  } });
  assert.deepEqual(refs.sort(), ['cache', 'rl-data-victim', 'traefik-acme']);
});

test('ensureOwnedVolume refuses a foreign volume and stamps a fresh one', async () => {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rlg-')), 'd.sock');
  const vols = { 'rl-data-victim': { Labels: { 'rl.role': 'env' } }, unlabelled: { Labels: null } };
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/volumes/create') {
        const b = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        vols[b.Name] = { Labels: b.Labels };
        res.writeHead(201).end('{}');
        return;
      }
      const name = decodeURIComponent((req.url ?? '').replace('/volumes/', ''));
      const v = vols[name];
      if (!v) res.writeHead(404).end('{"message":"no such volume"}');
      else res.writeHead(200).end(JSON.stringify(v));
    });
  });
  await new Promise((r) => fake.listen(sock, r));
  try {
    assert.equal(await ensureOwnedVolume(sock, 'rl-data-victim', ctx.owner, OWNER_LABEL), false);
    assert.equal(await ensureOwnedVolume(sock, 'unlabelled', ctx.owner, OWNER_LABEL), false);
    assert.equal(await ensureOwnedVolume(sock, 'fresh', ctx.owner, OWNER_LABEL), true);
    assert.equal(vols.fresh?.Labels?.[OWNER_LABEL], 'slot-2');
    assert.equal(await ensureOwnedVolume(sock, 'fresh', { owner: 'slot-1', slot: '1' }, OWNER_LABEL), false);
  } finally {
    await new Promise((r) => fake.close(r));
  }
});

test('image-inherited reserved labels are overridden on create (Docker merges image Config.Labels under the body)', () => {
  // A runner-built image with `LABEL rl.role=env rl.env_slug=<victim>` adds no
  // body labels, so the body check alone would let the image's values through.
  for (const Labels of [undefined, {}, { 'org.testcontainers': 'true' }]) {
    const v = checkContainerCreate({ Image: 'forged-env-image', ...(Labels ? { Labels } : {}) }, ctx);
    assert.equal(v.ok, true);
    assert.ok(v.ok && 'rl.role' in v.body.Labels && 'rl.env_slug' in v.body.Labels, 'both reserved keys must be named');
    assert.equal(v.ok && v.body.Labels['rl.role'], 'runner-child');
    assert.equal(v.ok && v.body.Labels['rl.env_slug'], '');
    assert.equal(v.ok && v.body.Labels['rl.slot'], '2');
  }
  // A non-reserved role the caller chose (validate-ci's redis sidecar) is kept.
  const redis = checkContainerCreate({ Image: 'redis:7-alpine', Labels: { 'rl.role': 'test-redis' } }, ctx);
  assert.equal(redis.ok && redis.body.Labels['rl.role'], 'test-redis');
  assert.equal(redis.ok && redis.body.Labels['rl.env_slug'], '');
  // The body-side refusal still holds.
  assert.equal(checkContainerCreate({ Image: 'a', Labels: { 'rl.role': 'env' } }, ctx).ok, false);
  assert.equal(checkContainerCreate({ Image: 'a', Labels: { 'rl.env_slug': 'victim' } }, ctx).ok, false);
});
