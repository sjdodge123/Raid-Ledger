/**
 * Demo community lineups installer integration tests (ROK-1346).
 *
 * Verifies that `installDemoData` seeds community lineups across phases
 * + visibilities with rich participant rosters, so the lineup surfaces
 * (Participants button, voting, decided) are testable in any seeded env.
 *
 * Asserts against a real PostgreSQL database via the DemoDataService and
 * the same `buildParticipantsRoster` helper the /lineups/:id/participants
 * route uses.
 */
import { eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { SettingsService } from '../settings/settings.service';
import * as schema from '../drizzle/schema';
import { DemoDataService } from './demo-data.service';
import {
  DEMO_LINEUP_TITLES,
  installCommunityLineups,
} from './demo-data-install-lineups.helpers';
import { buildParticipantsRoster } from '../lineups/lineups-participants.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

/** Fetch the seeded demo lineups by their known titles. */
async function demoLineups(app: TestApp) {
  return app.db
    .select()
    .from(schema.communityLineups)
    .where(inArray(schema.communityLineups.title, [...DEMO_LINEUP_TITLES]));
}

/**
 * The integration seed only inserts one game ("Test Game"); a real dev /
 * fleet env has the full IGDB catalog. The demo lineup seeder needs several
 * distinct games (one per nominator across lineups), so top the table up to
 * a dozen before installing. Idempotent against the unique slug constraint.
 */
async function seedGames(app: TestApp): Promise<void> {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    name: `Demo Lineup Game ${i}`,
    slug: `demo-lineup-game-${i}`,
    coverUrl: null,
    igdbId: 900_000 + i,
  }));
  await app.db.insert(schema.games).values(rows).onConflictDoNothing();
}

function describeInstall() {
  let testApp: TestApp;

  /** DemoDataService refuses to install when demo users already exist. */
  async function freshInstall(): Promise<void> {
    process.env.DEMO_MODE = 'true';
    await testApp.app.get(SettingsService).setDemoMode(true);
    await seedGames(testApp);
    const result = await testApp.app.get(DemoDataService).installDemoData();
    expect(result.success).toBe(true);
  }

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterAll(() => {
    if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    await loginAsAdmin(testApp.request, testApp.seed);
  });

  describe('installDemoData → community lineups', () => {
    it('seeds ≥3 lineups including a public and a private one', async () => {
      await freshInstall();
      const lineups = await demoLineups(testApp);
      expect(lineups.length).toBeGreaterThanOrEqual(3);
      const visibilities = lineups.map((l) => l.visibility);
      expect(visibilities).toContain('public');
      expect(visibilities).toContain('private');
      // Phase coverage: at least the decided lineup is past voting.
      expect(lineups.map((l) => l.status)).toContain('decided');
    }, 120_000);

    it('public voting lineup carries entries + votes', async () => {
      await freshInstall();
      const [publicLineup] = await demoLineups(testApp).then((rows) =>
        rows.filter((l) => l.title === DEMO_LINEUP_TITLES[0]),
      );
      expect(publicLineup).toBeDefined();
      expect(publicLineup.status).toBe('voting');

      const entries = await testApp.db
        .select({ id: schema.communityLineupEntries.id })
        .from(schema.communityLineupEntries)
        .where(eq(schema.communityLineupEntries.lineupId, publicLineup.id));
      const votes = await testApp.db
        .select({ id: schema.communityLineupVotes.id })
        .from(schema.communityLineupVotes)
        .where(eq(schema.communityLineupVotes.lineupId, publicLineup.id));
      expect(entries.length).toBeGreaterThanOrEqual(3);
      expect(votes.length).toBeGreaterThanOrEqual(2);
    }, 120_000);

    it('public roster has >1 participant incl. a voted + a nominated status', async () => {
      await freshInstall();
      const [publicLineup] = await demoLineups(testApp).then((rows) =>
        rows.filter((l) => l.title === DEMO_LINEUP_TITLES[0]),
      );
      const roster = await buildParticipantsRoster(testApp.db, publicLineup.id);
      expect(roster.length).toBeGreaterThan(1);
      const statuses = roster.map((p) => p.status);
      expect(statuses).toContain('voted');
      expect(statuses).toContain('nominated');
      // Creator is always present and listed first.
      expect(roster[0].role).toBe('creator');
    }, 120_000);

    it('private building lineup roster is creator + invitees', async () => {
      await freshInstall();
      const [privateLineup] = await demoLineups(testApp).then((rows) =>
        rows.filter((l) => l.title === DEMO_LINEUP_TITLES[1]),
      );
      expect(privateLineup.visibility).toBe('private');
      expect(privateLineup.status).toBe('building');

      const roster = await buildParticipantsRoster(
        testApp.db,
        privateLineup.id,
      );
      const roles = roster.map((p) => p.role);
      expect(roles).toContain('creator');
      expect(roles).toContain('invitee');
    }, 120_000);

    it('is idempotent — a second installCommunityLineups call adds nothing', async () => {
      await freshInstall();
      const before = await demoLineups(testApp);
      const allUsers = await testApp.db.select().from(schema.users);
      const allGames = await testApp.db.select().from(schema.games);

      const result = await installCommunityLineups(
        testApp.db,
        allUsers,
        allGames,
      );
      expect(result.lineups).toBe(0);

      const after = await demoLineups(testApp);
      expect(after.length).toBe(before.length);
    }, 120_000);
  });
}

describe('Demo community lineups (integration)', () => describeInstall());
