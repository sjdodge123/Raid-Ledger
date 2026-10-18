// ROK-1846 c1 (Codex P1) — a classic-builder `ADD http://127.0.0.1:2375/...`
// makes the DAEMON fetch the body-blind loopback proxy from the host network.
// The guard spools the context, reads the Dockerfile the build will use, and
// refuses remote ADD sources and COPY --from of an infra image.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { dockerfileReason } from '../src/dockerfile-policy.mjs';
import { createTarScanner } from '../src/tar-scan.mjs';
import { createGuardServer } from '../src/guard.mjs';
import { startFakeDaemon } from './fake-daemon.mjs';
import { paxRecord, tarOf } from './tar-fixture.mjs';

const LEAK = 'FROM alpine\nADD http://127.0.0.1:2375/containers/victim/json /leak\n';
const PLAIN = 'FROM node:22-alpine AS deps\nCOPY package.json ./\nFROM alpine\nCOPY --from=deps /app /app\nADD files.tar.gz /srv/\n';

test('dockerfileReason refuses remote / variable ADD sources and infra COPY --from', () => {
  for (const df of [LEAK, 'FROM a\nadd ["https://x/y", "/z"]\n', 'FROM a\nADD --chown=1 \\\n  "htt\\p://127.0.0.1:2375/info" /i\n',
    'FROM a\nARG U\nADD $U /x\n', 'FROM a\nONBUILD ADD http://127.0.0.1:2375/info /x\n', '# escape=`\nFROM a\nADD `\n http://x/ /y\n',
    'FROM a\nCOPY --from=rl-infra/orchestrator:latest /etc /e\n', 'FROM a\nCOPY --from=$IMG / /\n']) {
    assert.notEqual(dockerfileReason(df), null, df);
  }
  assert.equal(dockerfileReason(PLAIN), null);
  assert.equal(dockerfileReason('FROM a\n# ADD http://commented/out /x\nCOPY --from=0 / /\nCOPY --from=redis:7 /x /y\n'), null);
});

test('the tar scanner honours PAX path and GNU long names, and refuses a symlinked Dockerfile', () => {
  const scan = (tar, want = ['Dockerfile']) => {
    const s = createTarScanner(new Set(want));
    s.push(tar);
    return s.end();
  };
  const pax = tarOf([{ name: 'PaxHeader', type: 'x', data: paxRecord('path', 'Dockerfile') }, { name: 'innocent', data: LEAK }]);
  assert.equal(scan(pax).files[0]?.data.toString(), LEAK);
  const gnu = tarOf([{ name: '././@LongLink', type: 'L', data: 'Dockerfile\0' }, { name: 'innocent', data: LEAK }]);
  assert.equal(scan(gnu).files[0]?.data.toString(), LEAK);
  assert.notEqual(scan(tarOf([{ name: 'Dockerfile', type: '2' }])).error, null);
  assert.equal(scan(tarOf([{ name: './Dockerfile', data: PLAIN }])).files.length, 1);
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

function build(query, body) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/build?t=rl:ci-test${query}`, headers: { 'Content-Type': 'application/x-tar' }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.end(body);
  });
}

test('a context whose Dockerfile ADDs a URL is 403 build_dockerfile_policy and never reaches the daemon', async () => {
  for (const [q, tar] of [['', tarOf([{ name: 'Dockerfile', data: LEAK }])], ['&dockerfile=docker/Df', tarOf([{ name: 'Dockerfile', data: PLAIN }, { name: 'docker/Df', data: LEAK }])],
    ['', zlib.gzipSync(tarOf([{ name: 'Dockerfile', data: LEAK }]))], ['', tarOf([{ name: 'README', data: 'x' }])]]) {
    const r = await build(q, tar);
    assert.equal(r.status, 403, q);
    assert.match(r.text, /build_dockerfile_policy/);
  }
  assert.equal((await build('', Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 1, 2]))).status, 415);
  assert.equal(daemon.builds.length, 0);
});

test('the Codex c2 sequence (dockerfile, empty PAX path, Dockerfile) is 403 build_context_ambiguous at the guard', async () => {
  const tar = tarOf([{ name: 'dockerfile', data: PLAIN }, { name: 'PaxHeader', type: 'x', data: paxRecord('path', '') }, { name: 'Dockerfile', data: LEAK }]);
  const r = await build('', tar);
  assert.equal(r.status, 403);
  assert.match(r.text, /build_context_ambiguous/);
  assert.equal(daemon.builds.length, 0);
});

test('a plain context is forwarded byte-for-byte', async () => {
  const tar = tarOf([{ name: 'Dockerfile', data: PLAIN }, { name: 'package.json', data: '{}' }]);
  const r = await build('', tar);
  assert.equal(r.status, 200);
  assert.equal(daemon.builds.length, 1);
  assert.ok(daemon.builds[0]?.equals(tar));
});
