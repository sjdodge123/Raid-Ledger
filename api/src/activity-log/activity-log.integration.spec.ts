/**
 * Activity Log Integration Tests (ROK-930)
 *
 * Verifies activity timeline endpoints against a real PostgreSQL database.
 * Tests cover: direct DB logging, GET endpoints for lineups and events,
 * and that mutations (create lineup, signup) produce activity entries.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

interface ActivityEntry {
  id: number;
  action: string;
  actor: { id: number; displayName: string } | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface TimelineBody {
  data: ActivityEntry[];
}

function timeline(res: { body: unknown }): TimelineBody {
  return res.body as TimelineBody;
}

function describeActivityLog() {
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

  // ── GET /lineups/:id/activity ─────────────────────────────────

  function describeLineupActivity() {
    it('should return empty timeline for new lineup', async () => {
      const createRes = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Activity Log Test' });

      const lineupId = createRes.body.id as number;
      const res = await testApp.request
        .get(`/lineups/${lineupId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(timeline(res).data).toBeInstanceOf(Array);
      // lineup_created should have been logged
      expect(timeline(res).data.length).toBeGreaterThanOrEqual(1);
      expect(timeline(res).data[0]).toMatchObject({
        action: 'lineup_created',
        actor: expect.objectContaining({
          id: expect.any(Number),
          displayName: expect.any(String),
        }),
        createdAt: expect.any(String),
      });
    });

    it('should log game_nominated when a game is nominated', async () => {
      const createRes = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Activity Log Test' });
      const lineupId = createRes.body.id as number;

      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      const res = await testApp.request
        .get(`/lineups/${lineupId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const actions = timeline(res).data.map((e) => e.action);
      expect(actions).toContain('lineup_created');
      expect(actions).toContain('game_nominated');

      const nomination = timeline(res).data.find(
        (e) => e.action === 'game_nominated',
      );
      expect(nomination!.metadata).toMatchObject({
        gameId: testApp.seed.game.id,
        gameName: 'Test Game',
      });
    });

    it('should log voting_started on status transition', async () => {
      const createRes = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Activity Log Test' });
      const lineupId = createRes.body.id as number;

      await testApp.request
        .patch(`/lineups/${lineupId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'voting' });

      const res = await testApp.request
        .get(`/lineups/${lineupId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      const actions = timeline(res).data.map((e) => e.action);
      expect(actions).toContain('voting_started');
    });

    it('should return entries in chronological order', async () => {
      const createRes = await testApp.request
        .post('/lineups')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Activity Log Test' });
      const lineupId = createRes.body.id as number;

      await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ gameId: testApp.seed.game.id });

      const res = await testApp.request
        .get(`/lineups/${lineupId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      const timestamps = timeline(res).data.map((e) =>
        new Date(e.createdAt).getTime(),
      );
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });

    it('should require authentication', async () => {
      const res = await testApp.request.get('/lineups/1/activity');
      expect(res.status).toBe(401);
    });
  }
  describe('GET /lineups/:id/activity', describeLineupActivity);

  // ── GET /events/:id/activity ──────────────────────────────────

  function describeEventActivity() {
    async function createEvent(token: string) {
      const start = new Date(Date.now() + 86400000).toISOString();
      const end = new Date(Date.now() + 90000000).toISOString();
      return testApp.request
        .post('/events')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Test Event',
          startTime: start,
          endTime: end,
        });
    }

    it('should return event_created after creating an event', async () => {
      const createRes = await createEvent(adminToken);
      expect(createRes.status).toBe(201);
      const eventId = createRes.body.id as number;

      const res = await testApp.request
        .get(`/events/${eventId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(timeline(res).data).toBeInstanceOf(Array);
      const actions = timeline(res).data.map((e) => e.action);
      // event_created + signup_added (creator auto-signs up)
      expect(actions).toContain('event_created');
      expect(actions).toContain('signup_added');
    });

    it('should return timeline with correct shape', async () => {
      const createRes = await createEvent(adminToken);
      const eventId = createRes.body.id as number;

      const res = await testApp.request.get(`/events/${eventId}/activity`);

      expect(res.status).toBe(200);
      expect(timeline(res).data[0]).toMatchObject({
        id: expect.any(Number),
        action: expect.any(String),
        createdAt: expect.any(String),
      });
    });

    it('should return empty array for entity with no activity', async () => {
      // Query a non-existent entity — returns 200 with empty data
      const res = await testApp.request.get('/events/99999/activity');

      expect(res.status).toBe(200);
      expect(timeline(res).data).toEqual([]);
    });
  }
  describe('GET /events/:id/activity', describeEventActivity);

  // ── Direct DB logging ─────────────────────────────────────────

  function describeDirectLogging() {
    it('should persist activity log entries to DB', async () => {
      await testApp.db.insert(schema.activityLog).values({
        entityType: 'event',
        entityId: 999,
        action: 'event_created',
        actorId: testApp.seed.adminUser.id,
        metadata: { title: 'Direct insert test' },
      });

      const rows = await testApp.db.select().from(schema.activityLog);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        entityType: 'event',
        entityId: 999,
        action: 'event_created',
        actorId: testApp.seed.adminUser.id,
      });
      expect(rows[0].metadata).toMatchObject({
        title: 'Direct insert test',
      });
    });
  }
  describe('Direct DB logging', describeDirectLogging);

  // ── displayName fallback (ROK-1116) ───────────────────────────

  function describeUsernameFallback() {
    const ENTITY_TYPE = 'event' as const;

    it('returns username when actor displayName is null', async () => {
      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'rok-1116:null-display',
          username: 'alice',
          displayName: null,
        })
        .returning();

      const entityId = 90001;
      await testApp.db.insert(schema.activityLog).values({
        entityType: ENTITY_TYPE,
        entityId,
        action: 'event_created',
        actorId: user.id,
        metadata: null,
      });

      const res = await testApp.request
        .get(`/events/${entityId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const body = timeline(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].actor).not.toBeNull();
      expect(body.data[0].actor!.displayName).toBe('alice');
      expect(body.data[0].actor!.displayName).not.toBe('Unknown');
    });

    it('returns displayName when set', async () => {
      const [user] = await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'rok-1116:has-display',
          username: 'alice',
          displayName: 'AliceCustom',
        })
        .returning();

      const entityId = 90002;
      await testApp.db.insert(schema.activityLog).values({
        entityType: ENTITY_TYPE,
        entityId,
        action: 'event_created',
        actorId: user.id,
        metadata: null,
      });

      const res = await testApp.request
        .get(`/events/${entityId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const body = timeline(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].actor!.displayName).toBe('AliceCustom');
    });

    it('returns "Unknown" only when actor row is missing entirely', async () => {
      // Simulate the legitimate orphan case: an activity_log row whose
      // actor_id no longer resolves to a users row. The schema FK
      // (`onDelete: 'set null'`) makes this unreachable via normal user
      // deletion, so we bypass FK enforcement to insert a stale id —
      // mirroring DBs that were restored from a backup taken before the
      // FK existed, or migrated from another system.
      const entityId = 90003;
      const orphanActorId = 9_999_999;
      await testApp.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
        await tx.insert(schema.activityLog).values({
          entityType: ENTITY_TYPE,
          entityId,
          action: 'event_created',
          actorId: orphanActorId,
          metadata: null,
        });
      });

      const res = await testApp.request
        .get(`/events/${entityId}/activity`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const body = timeline(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].actor).not.toBeNull();
      expect(body.data[0].actor!.displayName).toBe('Unknown');
    });
  }
  describe('displayName fallback (ROK-1116)', describeUsernameFallback);
}
describe('Activity Log (integration)', describeActivityLog);
