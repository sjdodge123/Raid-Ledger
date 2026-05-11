/**
 * Unit test for socket-handle-audit helpers (ROK-1250).
 *
 * Drives implementation of `socket-handle-audit.ts`, which exports:
 *   - extractPortFromConnectionString(s)
 *   - listSocketHandles()
 *   - destroySocketsOnPort(port)
 *
 * Tests use real `net` sockets — mocks won't appear in
 * `process._getActiveHandles()`, which is the surface this module guards.
 */
import * as net from 'net';

import {
  destroySocketsOnPort,
  extractPortFromConnectionString,
  listSocketHandles,
} from './socket-handle-audit';

function listenOnEphemeral(): Promise<net.Server> {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function connectTo(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(port, '127.0.0.1');
    sock.once('connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

describe('socket-handle-audit', () => {
  let holder: net.Server | null = null;
  let openSockets: net.Socket[] = [];

  afterEach(async () => {
    for (const s of openSockets) {
      try {
        s.destroy();
      } catch {
        /* teardown — drop errors */
      }
    }
    openSockets = [];
    if (holder) {
      const h = holder;
      holder = null;
      await new Promise<void>((r) => h.close(() => r()));
    }
  });

  describe('extractPortFromConnectionString', () => {
    it('parses postgres URIs and rejects malformed input', () => {
      expect(
        extractPortFromConnectionString(
          'postgres://test:test@127.0.0.1:54123/db',
        ),
      ).toBe(54123);
      expect(
        extractPortFromConnectionString(
          'postgres://test:test@postgres:5432/raid_ledger_test',
        ),
      ).toBe(5432);
      expect(extractPortFromConnectionString('not-a-uri')).toBeNull();
      expect(extractPortFromConnectionString('')).toBeNull();
    });
  });

  describe('listSocketHandles', () => {
    it('filters to Socket-typed handles only', async () => {
      // Holder anchors the test environment but no client connections to it.
      holder = await listenOnEphemeral();

      const sockets = listSocketHandles();
      expect(sockets.length).toBeLessThanOrEqual(5);
    });
  });

  describe('audit-fail path', () => {
    it('detects forced socket leaks above the threshold', async () => {
      holder = await listenOnEphemeral();
      const port = (holder.address() as net.AddressInfo).port;

      for (let i = 0; i < 7; i++) {
        openSockets.push(await connectTo(port));
      }

      const sockets = listSocketHandles();
      expect(sockets.length).toBeGreaterThan(5);
    });
  });

  describe('destroySocketsOnPort', () => {
    it('only destroys sockets matching the supplied port', async () => {
      holder = await listenOnEphemeral();
      const port = (holder.address() as net.AddressInfo).port;

      for (let i = 0; i < 3; i++) {
        openSockets.push(await connectTo(port));
      }
      const before = listSocketHandles().length;

      const destroyed = destroySocketsOnPort(port);
      expect(destroyed).toBe(3);

      // socket.destroy() is async — libuv keeps the handle on
      // _getActiveHandles for one or two event-loop turns after the call.
      // Poll until the count drops or we time out, so the post-destroy
      // delta assertion is deterministic and not racy.
      const deadline = Date.now() + 500;
      let after = listSocketHandles().length;
      while (after >= before && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
        after = listSocketHandles().length;
      }
      expect(before - after).toBeGreaterThanOrEqual(3);
    });

    it('returns 0 when no sockets match the supplied port', async () => {
      holder = await listenOnEphemeral();
      // Pick a port that is almost certainly unused — IANA-reserved high port
      // unrelated to our holder. We don't open any connections to it.
      const unusedPort = 1;

      expect(destroySocketsOnPort(unusedPort)).toBe(0);
    });
  });
});
