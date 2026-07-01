/**
 * ROK-1165 — Health endpoint split integration tests.
 *
 * Verifies the k8s-style liveness/readiness split against a real booted app:
 *   - `/health/live` returns 200 + { status: 'ok' } and touches NO
 *     external dependency (no DB `SELECT 1`, no Redis PING),
 *   - `/health/ready` retains the DB + Redis probe semantics (200 + shape),
 *   - `/health` is retained unchanged (deprecated but still probing).
 */
import { getTestApp, type TestApp } from './common/testing/test-app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

describe('Health endpoints (ROK-1165)', () => {
  describe('GET /health/live', () => {
    it('returns 200 with { status: "ok" }', async () => {
      const res = await testApp.request.get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('does not probe the database or Redis', async () => {
      const dbSpy = jest.spyOn(testApp.db, 'execute');
      const redisSpy = jest.spyOn(testApp.redisMock.client, 'ping');

      await testApp.request.get('/health/live');

      expect(dbSpy).not.toHaveBeenCalled();
      expect(redisSpy).not.toHaveBeenCalled();
      dbSpy.mockRestore();
      redisSpy.mockRestore();
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 and the DB + Redis probe shape when healthy', async () => {
      const res = await testApp.request.get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        db: { connected: true },
        redis: { connected: true },
      });
      expect(typeof res.body.db.latencyMs).toBe('number');
      expect(typeof res.body.redis.latencyMs).toBe('number');
    });
  });

  describe('GET /health (retained, deprecated)', () => {
    it('returns 200 with the original probe shape', async () => {
      const res = await testApp.request.get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        db: { connected: true },
        redis: { connected: true },
      });
      expect(typeof res.body.timestamp).toBe('string');
    });
  });
});
