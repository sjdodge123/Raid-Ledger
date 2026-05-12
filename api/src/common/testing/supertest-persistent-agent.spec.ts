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

  // ROK-1264 follow-up: discriminate whether the residual full-suite ECONNRESET
  // observed in `events.integration.spec.ts › shape parity per slice` is caused
  // by Promise.all'd parallel requests queueing through the maxSockets:1 agent.
  // The server adds a small delay so head-of-line waits are realistic.
  it('survives 100× Promise.all([5 parallel GETs]) on the pinned socket without RST', async () => {
    let connections = 0;
    const handler: http.RequestListener = (_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end('ok');
      }, 5);
    };
    await withServer(handler, async (server) => {
      server.on('connection', () => {
        connections += 1;
      });
      const request = wrapWithPersistentAgent(supertest.default(server));
      try {
        for (let i = 0; i < 100; i++) {
          const responses = await Promise.all([
            request.get('/'),
            request.get('/'),
            request.get('/'),
            request.get('/'),
            request.get('/'),
          ]);
          for (const r of responses) expect(r.status).toBe(200);
        }
        // 100 iterations × 5 parallel requests through maxSockets:1 should
        // still use exactly one socket (queueing, not new sockets per call).
        expect(connections).toBe(1);
      } finally {
        destroyPersistentAgent(request);
      }
    });
  }, 15_000);
});
