/**
 * Feedback Integration Tests (ROK-569)
 *
 * Verifies feedback submission (INSERT with auth) and feedback listing
 * (admin-only, paginated INNER JOIN with users) against a real
 * PostgreSQL database via HTTP endpoints.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

describe('Feedback (integration)', () => {
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

  // ===================================================================
  // POST /feedback (submitFeedback)
  // ===================================================================

  describe('POST /feedback', () => {
    it('should persist feedback and return the created entry', async () => {
      const res = await testApp.request
        .post('/feedback')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'bug',
          message: 'The login page crashes on mobile devices frequently',
          pageUrl: 'http://localhost:5173/login',
        });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        id: expect.any(Number),
        category: 'bug',
        message: 'The login page crashes on mobile devices frequently',
        pageUrl: 'http://localhost:5173/login',
        githubIssueUrl: null,
        createdAt: expect.any(String),
      });

      // Verify persisted in DB
      const [row] = await testApp.db.select().from(schema.feedback).limit(1);

      expect(row).toBeDefined();
      expect(row.category).toBe('bug');
      expect(row.userId).toBe(testApp.seed.adminUser.id);
    });

    it('should accept all valid feedback categories', async () => {
      const categories = ['bug', 'feature', 'improvement', 'other'];

      for (const category of categories) {
        const res = await testApp.request
          .post('/feedback')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            category,
            message: `Test feedback for ${category} category test`,
          });

        expect(res.status).toBe(201);
        expect(res.body.category).toBe(category);
      }
    });

    it('should require authentication', async () => {
      const res = await testApp.request.post('/feedback').send({
        category: 'bug',
        message: 'This should fail without auth token',
      });

      expect(res.status).toBe(401);
    });

    it('should reject message shorter than 10 characters', async () => {
      const res = await testApp.request
        .post('/feedback')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'bug',
          message: 'Short',
        });

      expect(res.status).toBe(400);
    });

    it('should reject invalid category', async () => {
      const res = await testApp.request
        .post('/feedback')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'invalid_category',
          message: 'This has an invalid category value',
        });

      expect(res.status).toBe(400);
    });
  });

  // ===================================================================
  // GET /feedback (listFeedback)
  // ===================================================================

  describe('GET /feedback', () => {
    it('should list feedback with usernames via INNER JOIN', async () => {
      // Submit some feedback first
      await testApp.request
        .post('/feedback')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'feature',
          message: 'Add dark mode toggle to the settings page',
        });

      await testApp.request
        .post('/feedback')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          category: 'improvement',
          message: 'The event list could use better filtering',
        });

      const res = await testApp.request
        .get('/feedback')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.meta).toMatchObject({
        total: 2,
        page: 1,
        limit: 20,
      });

      // Each entry should have the username from the JOIN
      for (const entry of res.body.data) {
        expect(entry).toMatchObject({
          id: expect.any(Number),
          userId: expect.any(Number),
          username: expect.any(String),
          category: expect.any(String),
          message: expect.any(String),
          createdAt: expect.any(String),
        });
      }
    });

    it('should support pagination', async () => {
      // Insert 3 feedback entries
      for (let i = 0; i < 3; i++) {
        await testApp.request
          .post('/feedback')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            category: 'other',
            message: `Feedback entry number ${i} for testing`,
          });
      }

      // Page 1, limit 2
      const page1 = await testApp.request
        .get('/feedback?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page1.status).toBe(200);
      expect(page1.body.data.length).toBe(2);
      expect(page1.body.meta.total).toBe(3);

      // Page 2, limit 2
      const page2 = await testApp.request
        .get('/feedback?page=2&limit=2')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBe(1);
    });

    it('should return empty data when no feedback exists', async () => {
      const res = await testApp.request
        .get('/feedback')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('should require admin authentication', async () => {
      const res = await testApp.request.get('/feedback');

      expect(res.status).toBe(401);
    });

    it('should reject non-admin users', async () => {
      const bcrypt = await import('bcrypt');
      const passwordHash = await bcrypt.hash('TestPassword123!', 4);

      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:member-feedback@test.local',
          username: 'member-feedback',
          role: 'member',
        })
        .returning();

      await testApp.db.insert(schema.localCredentials).values({
        email: 'member-feedback@test.local',
        passwordHash,
        userId: user.id,
      });

      const loginRes = await testApp.request.post('/auth/local').send({
        email: 'member-feedback@test.local',
        password: 'TestPassword123!',
      });

      const memberToken = loginRes.body.access_token as string;

      const res = await testApp.request
        .get('/feedback')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });
});
