// ROK-1846 c1 (Codex P1) — `GET /_ping` with Connection: Upgrade used to be
// spliced into a raw tunnel to the daemon, after which every later request on
// that socket skipped the guard. Only attach / exec start may hijack, and only
// after their ownership check; everything else is one checked request upstream.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createGuardServer } from '../src/guard.mjs';
import { startFakeDaemon } from './fake-daemon.mjs';

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

/** Send raw bytes, resolve with everything read within `ms` (or until close). */
function raw(payload, then = null, ms = 300) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(payload));
    let out = '';
    let sent = false;
    s.on('data', (c) => {
      out += c.toString('latin1');
      if (then && !sent && out.includes('\r\n\r\n')) { sent = true; s.write(then); }
    });
    const done = () => { s.destroy(); resolve(out); };
    s.on('close', done);
    setTimeout(done, ms);
  });
}

test('_ping with Connection: Upgrade is refused 400 and never tunnelled', async () => {
  const out = await raw('GET /_ping HTTP/1.1\r\nHost: d\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 400/);
  assert.deepEqual(daemon.upgrades, []);
});

test('an Upgrade header without Connection: Upgrade is refused 400 too', async () => {
  const out = await raw('GET /_ping HTTP/1.1\r\nHost: d\r\nUpgrade: tcp\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 400/);
  assert.equal(daemon.seen.some((r) => r.url === '/_ping'), false);
});

test('a plain request reaches the daemon with Connection: close and no upgrade headers', async () => {
  const out = await raw('GET /_ping HTTP/1.1\r\nHost: d\r\nKeep-Alive: timeout=99\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 200/);
  const ping = daemon.seen.find((r) => r.url === '/_ping');
  assert.equal(ping?.headers.connection, 'close');
  assert.equal(ping?.headers.upgrade, undefined);
  assert.equal(ping?.headers['keep-alive'], undefined);
});

test('attach on an owned container still hijacks; a foreign one is 403 with no tunnel', async () => {
  const req = (id) => `POST /v1.45/containers/${id}/attach?stream=1 HTTP/1.1\r\nHost: d\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n`;
  const mine = await raw(req('c-mine'), 'hello-stdin');
  assert.match(mine, /^HTTP\/1\.1 101/);
  assert.match(mine, /hello-stdin/);
  assert.deepEqual(daemon.upgrades, ['/v1.45/containers/c-mine/attach?stream=1']);
  const other = await raw(req('c-other'));
  assert.match(other, /^HTTP\/1\.1 403/);
  assert.equal(daemon.upgrades.length, 1);
});

test('a hijack the daemon declines leaves no channel for a second request', async () => {
  const out = await raw('POST /exec/e-none/start HTTP/1.1\r\nHost: d\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
  assert.match(out, /^HTTP\/1\.1 403/);
  assert.deepEqual(daemon.upgrades.filter((u) => u.includes('e-none')), []);
});
