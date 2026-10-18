// ROK-1846 r4 m4 — `GET /events` streams exec_create / exec_start / exec_die
// with Actor.Attributes.execID for EVERY container, so an exec id is not a
// secret. /exec/{id}/start|resize|json must check that the exec's container
// belongs to the caller, like every other route on an existing object.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { classify } from '../src/routes.mjs';
import { resourceLabels } from '../src/docker-client.mjs';

const OBJECTS = {
  '/exec/e-mine/json': { ID: 'e-mine', ContainerID: 'c-mine' },
  '/exec/e-orphan/json': { ID: 'e-orphan' },
  '/containers/c-mine/json': { Config: { Labels: { 'rl.guard.owner': 'slot-2' } } },
};
const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-exec-')), 'd.sock');
const daemon = http.createServer((req, res) => {
  const hit = OBJECTS[req.url ?? ''];
  res.statusCode = hit ? 200 : 404;
  res.end(JSON.stringify(hit ?? { message: 'no such object' }));
});
await new Promise((r) => daemon.listen(sock, r));
after(() => daemon.close());

test('exec start / resize / json need the exec to be owned', () => {
  for (const [m, u] of [['POST', '/v1.45/exec/abc/start'], ['POST', '/exec/abc/resize'], ['GET', '/exec/abc/json']]) {
    assert.deepEqual(classify(m, u).owned, { kind: 'exec', id: 'abc' }, `${m} ${u}`);
  }
});

test("an exec's owner labels are its container's", async () => {
  assert.equal((await resourceLabels(sock, 'exec', 'e-mine'))?.['rl.guard.owner'], 'slot-2');
  assert.equal(await resourceLabels(sock, 'exec', 'e-orphan'), null, 'no ContainerID');
  assert.equal(await resourceLabels(sock, 'exec', 'e-missing'), null, 'unknown exec');
});
