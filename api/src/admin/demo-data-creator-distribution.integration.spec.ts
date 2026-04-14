/**
 * Demo Data — Event Creator Distribution (ROK-1037)
 *
 * Verifies that after demo data install:
 * - ROLE_ACCOUNTS contains 3 raid leaders
 * - ALL original events are distributed round-robin across 3 raid leaders
 * - Edge-condition events exist: ad-hoc (live + ended), cancelled, no-game
 */
import { eq, isNull, isNotNull, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { ROLE_ACCOUNTS } from './demo-data.constants';

/** Raid leader usernames expected after ROK-1037. */
const EXPECTED_RAID_LEADERS = ['ShadowMage', 'ProRaider', 'TankMaster'];

function describeCreatorDistribution() {
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

  // =========================================================================
  // AC1: ROLE_ACCOUNTS contains 3 raid leaders
  // =========================================================================

  it('ROLE_ACCOUNTS should contain 3 raid leaders', () => {
    const raidLeaders = ROLE_ACCOUNTS.filter((a) => a.role === 'Raid Leader');
    expect(raidLeaders).toHaveLength(3);
    const names = raidLeaders.map((a) => a.username);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_RAID_LEADERS));
  });

  // =========================================================================
  // AC2: All original events distributed round-robin across 3 raid leaders
  // =========================================================================

  it('should distribute ALL original events across 3 raid leaders with none under SeedAdmin', async () => {
    // Install demo data
    const installRes = await testApp.request
      .post('/admin/settings/demo/install')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(installRes.status).toBe(200);
    expect(installRes.body.success).toBe(true);

    // Find the 3 raid leader users
    const raidLeaderNames = EXPECTED_RAID_LEADERS;
    const raidLeaderUsers = await testApp.db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.username, raidLeaderNames));
    expect(raidLeaderUsers).toHaveLength(3);
    const raidLeaderIds = new Set(raidLeaderUsers.map((u) => u.id));

    // Find SeedAdmin
    const [seedAdmin] = await testApp.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'SeedAdmin'));
    expect(seedAdmin).toBeDefined();

    // Get original events: the first 6 events inserted (non-ad-hoc,
    // non-cancelled, with a gameId, matching the 6 original titles)
    const originalTitles = [
      'Heroic Amirdrassil Clear',
      'Mythic+ Push Night',
      'Valheim Boss Rush',
      'FFXIV Savage Prog',
      'Morning Dungeon Runs',
      'Late Night Raids',
    ];
    const origEvents = await testApp.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        creatorId: schema.events.creatorId,
      })
      .from(schema.events)
      .where(inArray(schema.events.title, originalTitles));

    expect(origEvents.length).toBeGreaterThanOrEqual(6);

    // AC2a: No original event remains under SeedAdmin
    const seedAdminOrig = origEvents.filter(
      (e) => e.creatorId === seedAdmin.id,
    );
    expect(seedAdminOrig).toHaveLength(0);

    // AC2b: All original events are owned by one of the 3 raid leaders
    for (const event of origEvents) {
      expect(raidLeaderIds.has(event.creatorId)).toBe(true);
    }

    // AC2c: Each raid leader owns at least 2 original events
    for (const leaderId of raidLeaderIds) {
      const owned = origEvents.filter((e) => e.creatorId === leaderId);
      expect(owned.length).toBeGreaterThanOrEqual(2);
    }
  });

  // =========================================================================
  // AC3: At least 1 ad-hoc event with isAdHoc=true and adHocStatus='live'
  // =========================================================================

  it('should seed at least 1 ad-hoc event with live status', async () => {
    const installRes = await testApp.request
      .post('/admin/settings/demo/install')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(installRes.status).toBe(200);

    const liveAdHocEvents = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.isAdHoc, true));

    const liveOnes = liveAdHocEvents.filter((e) => e.adHocStatus === 'live');
    expect(liveOnes.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // AC4: At least 1 ad-hoc event with adHocStatus='ended'
  // =========================================================================

  it('should seed at least 1 ad-hoc event with ended status', async () => {
    const installRes = await testApp.request
      .post('/admin/settings/demo/install')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(installRes.status).toBe(200);

    const adHocEvents = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.isAdHoc, true));

    const endedOnes = adHocEvents.filter((e) => e.adHocStatus === 'ended');
    expect(endedOnes.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // AC5: At least 1 cancelled event with cancelledAt set
  // =========================================================================

  it('should seed at least 1 cancelled event', async () => {
    const installRes = await testApp.request
      .post('/admin/settings/demo/install')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(installRes.status).toBe(200);

    const cancelledEvents = await testApp.db
      .select()
      .from(schema.events)
      .where(isNotNull(schema.events.cancelledAt));

    expect(cancelledEvents.length).toBeGreaterThanOrEqual(1);
  });

  // =========================================================================
  // AC6: At least 1 intentionally seeded no-game event with gameId=null
  // =========================================================================

  it('should seed at least 1 intentionally no-game edge-condition event', async () => {
    const installRes = await testApp.request
      .post('/admin/settings/demo/install')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(installRes.status).toBe(200);

    // In the test DB, all events have null gameId incidentally (the test
    // DB has only "test-game" with no IGDB ID, so no games match by slug
    // or IGDB ID). To distinguish *intentionally* seeded no-game events
    // from accidental ones, we exclude:
    //   1. The 6 original events (null gameId from missing game slugs)
    //   2. Generated events (title pattern "X — GameName", null from
    //      missing IGDB mappings in test DB)
    // What remains must be an explicitly seeded no-game edge-condition event.
    const originalTitles = [
      'Heroic Amirdrassil Clear',
      'Mythic+ Push Night',
      'Valheim Boss Rush',
      'FFXIV Savage Prog',
      'Morning Dungeon Runs',
      'Late Night Raids',
    ];
    const allNoGame = await testApp.db
      .select({ id: schema.events.id, title: schema.events.title })
      .from(schema.events)
      .where(isNull(schema.events.gameId));

    const intentionalNoGame = allNoGame.filter((e) => {
      // Exclude original events
      if (originalTitles.includes(e.title)) return false;
      // Exclude generated events (they follow "Title — GameName" pattern)
      if (e.title.includes(' — ')) return false;
      return true;
    });
    expect(intentionalNoGame.length).toBeGreaterThanOrEqual(1);
  });
}

describe('Demo Data — Creator Distribution (integration)', () =>
  describeCreatorDistribution());
