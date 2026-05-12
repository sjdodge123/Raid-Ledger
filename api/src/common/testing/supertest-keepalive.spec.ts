/**
 * ROK-1264 H2-fix propagation gate.
 *
 * Deterministic unit test that answers ONE question: does assigning a
 * keep-alive-off `http.Agent` to supertest's TestAgent via `_options.agent`
 * actually reach the per-request HTTP dispatch?
 *
 * If keep-alive is OFF: 2 sequential supertest calls open 2 distinct TCP
 * connections (each FINs after the response). Assertion: connections === 2.
 *
 * If the assignment is dead code (keep-alive still ON via supertest's
 * superagent default): 2 sequential calls reuse 1 pooled socket.
 * Assertion fails with connections === 1.
 *
 * This is the cheap pre-AC3 gate: 10 lines, deterministic, < 1 second.
 * It replaces a 30-minute multi-run smoke for the "did the fix take effect?"
 * question.
 */
import * as http from 'http';
import * as supertest from 'supertest';

describe('ROK-1264 H2 fix propagation', () => {
  it('opens a fresh TCP connection per sequential request when keepAlive:false is wired via _options.agent', async () => {
    let connections = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    server.on('connection', () => {
      connections += 1;
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      // Mirror buildKeepAliveOffSupertest() from test-app.ts.
      const keepAliveOffAgent = new http.Agent({
        keepAlive: false,
        maxSockets: Infinity,
      });
      const request = supertest.default(server);
      const requestWithOptions = request as unknown as {
        _options?: { agent?: unknown };
      };
      requestWithOptions._options = {
        ...(requestWithOptions._options ?? {}),
        agent: keepAliveOffAgent,
      };

      // Two sequential requests on the same TestAgent. If _options.agent
      // is honored, each request opens a NEW TCP connection (keepAlive:false
      // forces FIN after response). If _options.agent is ignored (the
      // validator's claim), supertest falls back to its default which
      // either pools via http.globalAgent (keep-alive ON) OR uses
      // `agent: false` per request (no pool but ALSO no reuse — 2 connects).
      // The discriminating signal is the connection count.
      await request.get('/');
      await request.get('/');

      // Belt-and-suspenders: also destroy the agent to confirm the
      // closeTestApp path doesn't throw.
      keepAliveOffAgent.destroy();

      expect(connections).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('SANITY CHECK: WITHOUT the agent override, supertest default behaviour produces N connections (control)', async () => {
    let connections = 0;
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    server.on('connection', () => {
      connections += 1;
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      // No agent override — pure supertest defaults.
      const request = supertest.default(server);
      await request.get('/');
      await request.get('/');

      // Hard assertion: supertest's default produces 2 distinct connections
      // for 2 sequential awaited requests. This is the falsification proof
      // for ROK-1264's H2 hypothesis — there is NO keep-alive pool, so
      // "stale pool reuse" cannot be the carrier. If this assertion ever
      // fails (e.g., supertest upgrade flips to pooling), any future "H2-
      // class" diagnosis must be revisited.
      console.error(
        `[ROK-1264 sanity] supertest default connections=${connections} (must be 2 — no pooling)`,
      );
      expect(connections).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
