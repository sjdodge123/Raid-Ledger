// ROK-1846 c1 (Codex P1) — Docker's httputils.ParseForm merges an
// application/x-www-form-urlencoded BODY into the query, so `remote=` /
// `networkmode=host` / `fromSrc=` sent in the body skipped the URL checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { classify } from '../src/routes.mjs';
import { contentTypeReason } from '../src/request-policy.mjs';
import { createGuardServer } from '../src/guard.mjs';
import { startFakeDaemon } from './fake-daemon.mjs';

test('build remote= is refused even when empty', () => {
  assert.equal(classify('POST', '/build?remote=').ok, false);
  assert.equal(classify('POST', '/build?t=rl:ci-test').context, true);
});

test('build bodies must be a tar context; form bodies are refused everywhere', () => {
  const build = { ok: true, context: true };
  for (const ct of ['application/x-tar', 'application/tar', 'application/octet-stream', 'application/gzip', 'Application/X-Tar; charset=x', undefined]) {
    assert.equal(contentTypeReason(build, ct), null, String(ct));
  }
  for (const ct of ['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/json', 'text/plain']) {
    assert.equal(contentTypeReason(build, ct)?.status, 415, ct);
  }
  assert.equal(contentTypeReason({ ok: true }, 'application/x-www-form-urlencoded')?.status, 415);
  assert.equal(contentTypeReason({ ok: true }, 'APPLICATION/X-WWW-FORM-URLENCODED;x=1')?.status, 415);
  assert.equal(contentTypeReason({ ok: true }, 'application/json'), null);
});

let daemon;
let guard;
let port;
before(async () => {
  daemon = await startFakeDaemon();
  guard = createGuardServer({ socket: daemon.sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  port = guard.address().port;
});
after(async () => {
  guard.closeAllConnections();
  await new Promise((r) => guard.close(r));
  await daemon.close();
});

function post(path, contentType, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, headers: { 'Content-Type': contentType }, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.end(body);
  });
}

test('a form-encoded /build or /images/create body is 415 and never reaches the daemon', async () => {
  assert.equal(await post('/build?t=rl:ci-test', 'application/x-www-form-urlencoded', 'remote=http://127.0.0.1:2375/info&networkmode=host'), 415);
  assert.equal(await post('/images/create?fromImage=redis&tag=7', 'application/x-www-form-urlencoded', 'fromSrc=http://127.0.0.1:2375/info'), 415);
  assert.equal(daemon.seen.some((r) => r.url?.startsWith('/build') || r.url?.startsWith('/images/create')), false);
});
