/**
 * Slow Queries Controller — integration tests (ROK-1156).
 *
 * Verifies admin auth, contract-shape adherence, and that the snapshot
 * endpoint actually persists a `source='manual'` row even when
 * pg_stat_statements is unavailable in the test container (the service
 * tolerates the missing extension and writes an empty snapshot).
 */
import { eq } from 'drizzle-orm';
import { SlowQueryDigestSchema } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import { getTestApp, type TestApp } from '../common/testing/test-app';

describe('SlowQueriesController (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  describe('GET /admin/slow-queries/digest', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await testApp.request.get('/admin/slow-queries/digest');
      expect(res.status).toBe(401);
    });

    it('returns an empty payload when no snapshots exist yet', async () => {
      const res = await testApp.request
        .get('/admin/slow-queries/digest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ snapshot: null, baseline: null, entries: [] });
    });

    it('returns a contract-valid digest after a snapshot is captured', async () => {
      const captureRes = await testApp.request
        .post('/admin/slow-queries/snapshot')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(captureRes.status).toBe(200);

      const digestRes = await testApp.request
        .get('/admin/slow-queries/digest')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(digestRes.status).toBe(200);
      const parsed = SlowQueryDigestSchema.safeParse(digestRes.body);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.snapshot.source).toBe('manual');
    });

    it('honours the limit query parameter', async () => {
      await testApp.request
        .post('/admin/slow-queries/snapshot')
        .set('Authorization', `Bearer ${adminToken}`);

      const res = await testApp.request
        .get('/admin/slow-queries/digest?limit=3')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.entries)).toBe(true);
      expect(res.body.entries.length).toBeLessThanOrEqual(3);
    });
  });

  describe('POST /admin/slow-queries/snapshot', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await testApp.request.post('/admin/slow-queries/snapshot');
      expect(res.status).toBe(401);
    });

    it('persists a manual snapshot row and returns the digest', async () => {
      const res = await testApp.request
        .post('/admin/slow-queries/snapshot')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.snapshot.source).toBe('manual');

      const rows = await testApp.db
        .select()
        .from(schema.slowQuerySnapshots)
        .where(eq(schema.slowQuerySnapshots.source, 'manual'));
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });
});
