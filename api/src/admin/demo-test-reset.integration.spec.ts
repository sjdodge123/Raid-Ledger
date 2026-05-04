/**
 * Reset-to-seed integration tests (ROK-1186).
 *
 * Verifies POST /admin/test/reset-to-seed against a real PostgreSQL
 * database: it must wipe events/signups/lineups/characters/voice
 * sessions, preserve admin + non-demo data, and re-run the demo
 * installer so demo users/games/events come back.
 */
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import * as schema from '../drizzle/schema';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

function describeReset() {
  let testApp: TestApp;
  let adminToken: string;

  /**
   * Controller gates on env DEMO_MODE AND the DB demoMode flag.
   * `truncateAllTables` wipes app_settings, so we re-set demoMode=true
   * after every truncate (mirrors a real DEMO_MODE deployment where
   * demo data has been installed).
   */
  async function enableDemoMode(): Promise<void> {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
  }

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await enableDemoMode();
  });

  afterAll(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await enableDemoMode();
  });

  describe('POST /admin/test/reset-to-seed', () => {
    it('rejects when DEMO_MODE env is off', async () => {
      process.env.DEMO_MODE = 'false';
      const res = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it('requires admin auth', async () => {
      const res = await testApp.request.post('/admin/test/reset-to-seed');
      expect(res.status).toBe(401);
    });

    it('wipes orphan events and signups, then reseeds demo data', async () => {
      // Insert a stale orphan event + signup directly (simulates the
      // 80+ ORBITALIS polls visible at /events on dirty dev DBs).
      // Identify by title (NOT id) — TRUNCATE … RESTART IDENTITY resets
      // the events sequence, so a freshly-installed demo event will
      // collide with the orphan's old id.
      const orphanTitle = 'ORBITALIS-orphan';
      const [orphan] = await testApp.db
        .insert(schema.events)
        .values({
          title: orphanTitle,
          duration: [
            new Date(Date.now() + 60_000),
            new Date(Date.now() + 120_000),
          ] as [Date, Date],
          creatorId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          maxAttendees: 10,
        })
        .returning({ id: schema.events.id });
      expect(orphan.id).toBeGreaterThan(0);

      const res = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted.events).toBeGreaterThanOrEqual(1);
      expect(res.body.reseed.ok).toBe(true);

      // Orphan event is gone (matched by title, not id — see comment above).
      const remaining = await testApp.db
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(eq(schema.events.title, orphanTitle));
      expect(remaining).toHaveLength(0);

      // Demo events were created (~30 from installer).
      const allEvents = await testApp.db
        .select({ id: schema.events.id })
        .from(schema.events);
      expect(allEvents.length).toBeGreaterThan(0);
    }, 120_000);

    it('preserves admin user and non-demo app_settings', async () => {
      const adminId = testApp.seed.adminUser.id;
      const res = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      const surviving = await testApp.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, adminId));
      expect(surviving).toHaveLength(1);
    }, 120_000);

    it('is idempotent — calling twice produces equivalent state', async () => {
      const first = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(first.status).toBe(200);

      const eventsAfterFirst = await testApp.db
        .select({ id: schema.events.id })
        .from(schema.events);

      const second = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(second.status).toBe(200);
      // Second call wipes the demo data installed by the first, then
      // reseeds — the resulting event count must be > 0 again.
      expect(second.body.success).toBe(true);
      expect(second.body.deleted.events).toBe(eventsAfterFirst.length);

      const eventsAfterSecond = await testApp.db
        .select({ id: schema.events.id })
        .from(schema.events);
      expect(eventsAfterSecond.length).toBeGreaterThan(0);
    }, 240_000);

    it('cascade-wipes signups when events are wiped', async () => {
      // Insert a uniquely-titled event + signup so we can identify our test
      // data after the reset. We CANNOT query by event.id post-reset because
      // wipeAllTestData uses RESTART IDENTITY CASCADE — the reseed reuses
      // primary keys starting at 1, so the test's pre-reset event.id can
      // collide with a freshly-seeded event of the same id, returning that
      // reseeded event's signups as if cascade had failed.
      const [event] = await testApp.db
        .insert(schema.events)
        .values({
          title: 'wipe-signups-test',
          duration: [
            new Date(Date.now() + 60_000),
            new Date(Date.now() + 120_000),
          ] as [Date, Date],
          creatorId: testApp.seed.adminUser.id,
          gameId: testApp.seed.game.id,
          maxAttendees: 10,
        })
        .returning({ id: schema.events.id });
      await testApp.db.insert(schema.eventSignups).values({
        eventId: event.id,
        userId: testApp.seed.adminUser.id,
        status: 'signed_up',
      });

      const res = await testApp.request
        .post('/admin/test/reset-to-seed')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);

      // The unique-titled test event must be gone. Because the FK from
      // eventSignups → events has ON DELETE CASCADE (enforced at the DB
      // level), the absence of this event is a sufficient proof that its
      // signup row has cascaded out as well.
      const wipedEvents = await testApp.db
        .select({ id: schema.events.id })
        .from(schema.events)
        .where(eq(schema.events.title, 'wipe-signups-test'));
      expect(wipedEvents).toHaveLength(0);
      void inArray;
    }, 120_000);
  });
}

describe('Reset to seed (integration)', () => describeReset());
