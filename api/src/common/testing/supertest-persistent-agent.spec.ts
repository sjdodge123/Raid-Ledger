/**
 * ROK-1264 — regression gate for `wrapWithPersistentAgent`.
 *
 * Pins the propagation contract: every supertest call returned from a wrapped
 * TestAgent shares ONE keep-alive socket. If a future supertest/superagent
 * upgrade silently flips `Test._agent` plumbing such that `.agent(myAgent)`
 * is no longer honored per-request, this test fails — and any future
 * residual TCP-RST regression has a head-start on the diagnosis.
 *
 * Mirrors `supertest-keepalive.spec.ts` (which falsified the older H2 fix).
 * Together those two specs lock down the supertest behavior model the
 * ROK-1264 fix depends on.
 */
import * as http from 'http';
import * as supertest from 'supertest';
import {
  destroyPersistentAgent,
  wrapWithPersistentAgent,
} from './supertest-persistent-agent';

async function withServer<T>(
  handler: http.RequestListener,
  fn: (server: http.Server, port: number) => Promise<T>,
): Promise<T> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  try {
    return await fn(server, port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

describe('wrapWithPersistentAgent (ROK-1264)', () => {
  it('serializes 5 sequential requests onto exactly 1 TCP connection', async () => {
    let connections = 0;
    await withServer(
      (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      },
      async (server) => {
        server.on('connection', () => {
          connections += 1;
        });
        const request = wrapWithPersistentAgent(supertest.default(server));
        try {
          await request.get('/');
          await request.get('/');
          await request.post('/').send({ hi: 1 });
          await request.put('/').send({ hi: 2 });
          await request.delete('/');
          expect(connections).toBe(1);
        } finally {
          destroyPersistentAgent(request);
        }
      },
    );
  });

  it('is idempotent — re-wrapping does not double-pin the agent', async () => {
    let connections = 0;
    await withServer(
      (_req, res) => res.end('ok'),
      async (server) => {
        server.on('connection', () => {
          connections += 1;
        });
        let request = supertest.default(server);
        request = wrapWithPersistentAgent(request);
        request = wrapWithPersistentAgent(request);
        request = wrapWithPersistentAgent(request);
        try {
          await request.get('/');
          await request.get('/');
          expect(connections).toBe(1);
        } finally {
          destroyPersistentAgent(request);
        }
      },
    );
  });

  it('destroyPersistentAgent on an unwrapped TestAgent is a safe no-op', async () => {
    await withServer(
      () => undefined,
      (server) => {
        const request = supertest.default(server);
        expect(() => destroyPersistentAgent(request)).not.toThrow();
        return Promise.resolve();
      },
    );
  });
});
