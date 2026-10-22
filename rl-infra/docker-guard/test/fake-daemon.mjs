// ROK-1846 c1 — a fake Docker daemon on a unix socket for guard-level tests.
// Records every request / upgrade it sees, so a test can prove what the guard
// did NOT forward.
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const RUNNER = { Names: ['/rl-runner-2'], Labels: { 'com.docker.compose.service': 'runner-2', 'com.docker.compose.project': 'rl-infra' },
  NetworkSettings: { Networks: { guard: { IPAddress: '127.0.0.1' } } } };
const OWNED = { '/containers/c-mine/json': 'slot-2', '/containers/c-other/json': 'slot-1' };

/** Start a fake daemon; resolves { sock, seen, upgrades, builds, close }. */
export async function startFakeDaemon() {
  const sock = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-c1-')), 'd.sock');
  const seen = [];
  const upgrades = [];
  const builds = [];
  const daemon = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      const url = req.url ?? '';
      if (url.startsWith('/containers/json')) return res.end(JSON.stringify([RUNNER]));
      if (OWNED[url]) return res.end(JSON.stringify({ Config: { Labels: { 'rl.guard.owner': OWNED[url] } } }));
      if (url === '/_ping') return res.end('OK');
      if (url.startsWith('/build')) {
        builds.push(Buffer.concat(chunks));
        return res.end('{"stream":"built"}');
      }
      res.statusCode = 404;
      res.end('{"message":"no such object"}');
    });
  });
  daemon.on('upgrade', (req, socket) => {
    upgrades.push(req.url);
    socket.write('HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\n');
    socket.pipe(socket);
  });
  await new Promise((r) => daemon.listen(sock, r));
  return { sock, seen, upgrades, builds, close: () => new Promise((r) => { daemon.closeAllConnections?.(); daemon.close(r); }) };
}
