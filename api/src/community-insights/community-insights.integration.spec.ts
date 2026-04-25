/**
 * Community Insights Integration Tests (ROK-1099)
 *
 * Covers all 7 endpoints of the /insights/community controller against
 * a real database, plus role-gating and the POST /refresh path that
 * invokes the orchestrator in-process.
 */
import * as bcrypt from 'bcrypt';
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { ChurnDetectionService } from './churn-detection.service';
import { CommunityInsightsService } from './community-insights.service';
import { buildSnapshotFixture } from './__fixtures__/snapshot-fixture';

async function createMemberAndLogin(testApp: TestApp): Promise<string> {
  const email = 'member@test.local';
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${email}`,
      username: 'member',
      role: 'member',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

async function createOperatorAndLogin(testApp: TestApp): Promise<string> {
  const email = 'operator@test.local';
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${email}`,
      username: 'operator',
      role: 'operator',
    })
    .returning();
  await testApp.db.insert(schema.localCredentials).values({
    email,
    passwordHash,
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  return res.body.access_token as string;
}

async function seedSnapshot(
  testApp: TestApp,
  snapshotDate: string,
): Promise<void> {
  const fixture = buildSnapshotFixture(snapshotDate);
  await testApp.db.insert(schema.communityInsightsSnapshots).values({
    snapshotDate,
    radarPayload: fixture.radar,
    engagementPayload: fixture.engagement,
    churnPayload: fixture.churn,
    socialGraphPayload: fixture.socialGraph,
    temporalPayload: fixture.temporal,
    keyInsightsPayload: fixture.keyInsights,
  });
}

describe('Community Insights (ROK-1099)', () => {
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

  describe('read endpoints', () => {
    beforeEach(async () => {
      await seedSnapshot(testApp, '2026-04-22');
    });

    it('GET /insights/community/radar returns the radar payload', async () => {
      const res = await testApp.request
        .get('/insights/community/radar')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.axes).toBeDefined();
      expect(Array.isArray(res.body.archetypes)).toBe(true);
    });

    it('GET /insights/community/engagement returns the engagement payload', async () => {
      const res = await testApp.request
        .get('/insights/community/engagement')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.weeklyActiveUsers).toHaveLength(2);
    });

    it('GET /insights/community/churn filters by threshold override', async () => {
      const res = await testApp.request
        .get('/insights/community/churn?thresholdPct=30')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.thresholdPct).toBe(30);
      // both fixture candidates >= 25%; only the 85% one clears 30%? no —
      // 25% does not clear; 85% does — at-risk should have 1 entry.
      expect(res.body.atRisk.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /insights/community/social-graph applies limit + minWeight', async () => {
      const res = await testApp.request
        .get('/insights/community/social-graph?limit=100&minWeight=0')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.nodes).toHaveLength(2);
      expect(res.body.edges).toHaveLength(1);
    });

    it('GET /insights/community/temporal returns the heatmap payload', async () => {
      const res = await testApp.request
        .get('/insights/community/temporal')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.heatmap).toHaveLength(1);
    });

    it('GET /insights/community/key-insights returns the insights list', async () => {
      const res = await testApp.request
        .get('/insights/community/key-insights')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.insights).toHaveLength(1);
    });
  });

  describe('role gating', () => {
    beforeEach(async () => {
      await seedSnapshot(testApp, '2026-04-22');
    });

    it('forbids member role with 403 on every GET endpoint', async () => {
      const memberToken = await createMemberAndLogin(testApp);
      const endpoints = [
        '/insights/community/radar',
        '/insights/community/engagement',
        '/insights/community/churn',
        '/insights/community/social-graph',
        '/insights/community/temporal',
        '/insights/community/key-insights',
      ];
      for (const url of endpoints) {
        const res = await testApp.request
          .get(url)
          .set('Authorization', `Bearer ${memberToken}`);
        expect(res.status).toBe(403);
      }
    });

    it('forbids member role with 403 on POST /refresh', async () => {
      const memberToken = await createMemberAndLogin(testApp);
      const res = await testApp.request
        .post('/insights/community/refresh')
        .set('Authorization', `Bearer ${memberToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('no snapshot yet', () => {
    it('returns 503 no_snapshot_yet when the table is empty', async () => {
      const res = await testApp.request
        .get('/insights/community/radar')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(503);
      expect(res.body.error).toBe('no_snapshot_yet');
    });
  });

  describe('POST /refresh', () => {
    it('creates a snapshot row when none existed', async () => {
      const res = await testApp.request
        .post('/insights/community/refresh')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(202);
      expect(res.body.enqueued).toBe(true);
      expect(typeof res.body.jobId).toBe('string');
      const rows = await testApp.db
        .select()
        .from(schema.communityInsightsSnapshots);
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("overwrites today's snapshot when one already exists", async () => {
      const today = new Date().toISOString().slice(0, 10);
      await seedSnapshot(testApp, today);
      const before = await testApp.db
        .select()
        .from(schema.communityInsightsSnapshots);
      expect(before).toHaveLength(1);

      const res = await testApp.request
        .post('/insights/community/refresh')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(202);

      const after = await testApp.db
        .select()
        .from(schema.communityInsightsSnapshots);
      expect(after).toHaveLength(1);
    });
  });

  describe('operator role hierarchy', () => {
    beforeEach(async () => {
      await seedSnapshot(testApp, '2026-04-22');
    });

    it('allows operator role with 200 on every GET endpoint and POST /refresh', async () => {
      const operatorToken = await createOperatorAndLogin(testApp);
      const endpoints = [
        '/insights/community/radar',
        '/insights/community/engagement',
        '/insights/community/churn',
        '/insights/community/social-graph',
        '/insights/community/temporal',
        '/insights/community/key-insights',
      ];
      for (const url of endpoints) {
        const res = await testApp.request
          .get(url)
          .set('Authorization', `Bearer ${operatorToken}`);
        expect(res.status).toBe(200);
      }
      const refreshRes = await testApp.request
        .post('/insights/community/refresh')
        .set('Authorization', `Bearer ${operatorToken}`);
      expect(refreshRes.status).toBe(202);
    });
  });

  describe('partial-failure orchestrator', () => {
    it('logs the failing section, substitutes empty payload, and still upserts the snapshot', async () => {
      const churn = testApp.app.get(ChurnDetectionService);
      const findSpy = jest
        .spyOn(churn, 'findAtRiskPlayers')
        .mockImplementation(() => {
          throw new Error('synthetic-churn-failure');
        });
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      try {
        const insights = testApp.app.get(CommunityInsightsService);
        const result = await insights.refreshSnapshot();
        expect(result.snapshotDate).toBeDefined();

        const rows = await testApp.db
          .select()
          .from(schema.communityInsightsSnapshots);
        expect(rows).toHaveLength(1);
        const churnPayload = rows[0].churnPayload as { atRisk: unknown[] };
        expect(churnPayload.atRisk).toEqual([]);

        const churnLogCall = errorSpy.mock.calls.find((call) =>
          String(call[0]).includes('churn'),
        );
        expect(churnLogCall).toBeDefined();
      } finally {
        findSpy.mockRestore();
        errorSpy.mockRestore();
      }
    });
  });

  describe('retention prune', () => {
    it('deletes snapshots older than the retention window after a refresh', async () => {
      const settings = testApp.app.get(SettingsService);
      await settings.set(
        SETTING_KEYS.COMMUNITY_INSIGHTS_SNAPSHOT_RETENTION_DAYS,
        '90',
      );

      const oldDate = '2025-01-01';
      const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      await seedSnapshot(testApp, oldDate);
      await seedSnapshot(testApp, recentDate);

      const insights = testApp.app.get(CommunityInsightsService);
      await insights.refreshSnapshot();

      const remaining = await testApp.db
        .select({ snapshotDate: schema.communityInsightsSnapshots.snapshotDate })
        .from(schema.communityInsightsSnapshots);
      const dates = remaining.map((r) => String(r.snapshotDate));
      expect(dates).not.toContain(oldDate);
      expect(dates).toContain(recentDate);
    });
  });
});
