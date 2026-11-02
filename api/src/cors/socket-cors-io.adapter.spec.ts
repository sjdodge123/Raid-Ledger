/**
 * Codex P2 (fix-batch 2026-11-02): the socket.io polling transport must get
 * the same Host-aware `CORS_ORIGIN=auto` decision as HTTP. Drives a real
 * engine.io polling handshake through `SocketCorsIoAdapter` and reads ACAO.
 */
import { createServer } from 'http';
import type { Server } from 'socket.io';
import request from 'supertest';
import { SocketCorsIoAdapter } from './socket-cors-io.adapter';

const HANDSHAKE = '/socket.io/?EIO=4&transport=polling';
const SAME_HOST_OTHER_PORT = 'http://raid.example:8080';
const FOREIGN = 'https://evil.example.net';

/** Put one env key back as it was (deleting it when it was unset). */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('SocketCorsIoAdapter — polling handshake CORS', () => {
  const savedOrigin = process.env.CORS_ORIGIN;
  const savedMode = process.env.CORS_AUTO_MODE;
  let httpServer = createServer();
  let io: Server;

  beforeEach(() => {
    httpServer = createServer();
    // A gateway-supplied wildcard must not survive: the adapter owns `cors`.
    io = new SocketCorsIoAdapter(httpServer).createIOServer(0, {
      cors: { origin: '*' },
    });
  });

  afterEach(async () => {
    await io.close();
    restoreEnv('CORS_ORIGIN', savedOrigin);
    restoreEnv('CORS_AUTO_MODE', savedMode);
  });

  /** ACAO of one polling handshake with the given Origin and Host. */
  async function acao(origin: string, host: string): Promise<unknown> {
    const res = await request(httpServer)
      .get(HANDSHAKE)
      .set('Origin', origin)
      .set('Host', host);
    expect(res.status).toBe(200);
    return res.headers['access-control-allow-origin'];
  }

  it('auto allows a same-hostname Origin on another port (as HTTP does)', async () => {
    process.env.CORS_ORIGIN = 'auto';
    process.env.CORS_AUTO_MODE = 'enforce';
    expect(await acao(SAME_HOST_OTHER_PORT, 'raid.example:3000')).toBe(
      SAME_HOST_OTHER_PORT,
    );
  });

  it('auto grants a foreign Origin nothing, despite the gateway wildcard', async () => {
    process.env.CORS_ORIGIN = 'auto';
    process.env.CORS_AUTO_MODE = 'enforce';
    expect(await acao(FOREIGN, 'raid.example:3000')).toBeUndefined();
  });

  it('an explicit CORS_ORIGIN list is honoured regardless of Host', async () => {
    process.env.CORS_ORIGIN = 'https://app.example';
    expect(await acao('https://app.example', 'api.internal:3000')).toBe(
      'https://app.example',
    );
    expect(await acao(SAME_HOST_OTHER_PORT, 'raid.example')).toBeUndefined();
  });
});
