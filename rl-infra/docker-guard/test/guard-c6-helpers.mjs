// ROK-1846 c6 — a guard in front of the fake daemon, plus a one-shot client.
import http from 'node:http';
import { createGuardServer } from '../src/guard.mjs';
import { startFakeDaemon } from './fake-daemon.mjs';

/** Start fake daemon + guard; resolves { daemon, port, close }. */
export async function startGuard() {
  const daemon = await startFakeDaemon();
  const guard = createGuardServer({ socket: daemon.sock });
  await new Promise((r) => guard.listen(0, '127.0.0.1', r));
  const port = guard.address().port;
  const close = async () => {
    guard.closeAllConnections?.();
    await new Promise((r) => guard.close(r));
    await daemon.close();
  };
  return { daemon, port, close };
}

/** One request through the guard; resolves { status, body }. */
export function call(port, method, path, json) {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? null : Buffer.from(JSON.stringify(json));
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {};
    const req = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(payload ?? undefined);
  });
}
